"""
XRPCode Buddy Backend
FastAPI proxy for Gemini AI with XRP documentation context.
"""

import os
import glob
import secrets
import asyncio
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import google.generativeai as genai

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
MODEL_NAME = "gemini-2.5-flash-preview-05-20"

if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not set. Proxy AI mode will not work.")
else:
    genai.configure(api_key=GEMINI_API_KEY)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are XRPCode Buddy, an educational AI assistant integrated into the XRPCode IDE for the XRP (eXperiential Robotics Platform) robot. Your purpose is to help students and educators learn robotics programming.

You are knowledgeable about:
- The XRP robot hardware: differential drivetrain, servo motors, rangefinder (ultrasonic), reflectance sensors, wheel encoders, IMU (accelerometer + gyroscope), voltage/current sensors
- MicroPython programming for the XRP robot
- The XRP Python library and its modules (drivetrain, motor, servo, rangefinder, reflectance, encoded_motor, imu)
- Visual block-based programming with Blockly and how blocks map to Python
- Common robotics algorithms: line following, obstacle avoidance, PID control

Teaching style:
- Be friendly, encouraging, and patient with beginners
- Give clear, concise explanations with working MicroPython code examples
- When the user shares code or terminal output, analyze it specifically and give targeted help
- Prefer simple solutions first, then explain advanced options only if asked
- For errors, explain what went wrong and how to fix it step by step

When editor code is provided as context, reference it directly in your response. When terminal output is provided, help debug it."""

# ---------------------------------------------------------------------------
# XRP documentation loading
# ---------------------------------------------------------------------------

# Path relative to this file: ../public/lib/XRPLib
XRPLIB_DIR = Path(__file__).parent.parent / "public" / "lib" / "XRPLib"
EXAMPLES_DIR = Path(__file__).parent.parent / "public" / "lib" / "XRPExamples"

_docs_text: Optional[str] = None


def build_docs_text() -> str:
    """Concatenate all XRPLib source files into a single context string."""
    global _docs_text
    if _docs_text is not None:
        return _docs_text

    sections = ["# XRP Robot Library Reference\n"]

    for py_file in sorted(XRPLIB_DIR.glob("*.py")):
        try:
            code = py_file.read_text(encoding="utf-8")
            sections.append(f"\n## {py_file.name}\n```python\n{code}\n```\n")
        except Exception as e:
            print(f"Could not read {py_file}: {e}")

    sections.append("\n# XRP Example Programs\n")
    for py_file in sorted(EXAMPLES_DIR.glob("*.py")):
        try:
            code = py_file.read_text(encoding="utf-8")
            sections.append(f"\n## {py_file.name}\n```python\n{code}\n```\n")
        except Exception as e:
            print(f"Could not read {py_file}: {e}")

    _docs_text = "\n".join(sections)
    return _docs_text


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

# Maps session_id -> { "docs_loaded": bool, "history": [...] }
_sessions: dict[str, dict] = {}

# Valid handshake tokens (issued at /api/handshake)
_valid_tokens: set[str] = set()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="XRPCode Buddy Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def require_token(request: Request) -> str:
    token = request.headers.get("X-Handshake-Token", "")
    if token not in _valid_tokens:
        raise HTTPException(status_code=401, detail="Invalid or missing handshake token")
    return token


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/handshake")
async def handshake():
    """Issue a short-lived token to authenticate subsequent API calls."""
    token = secrets.token_hex(32)
    _valid_tokens.add(token)
    return {"handshake_token": token}


# --- Docs ---

class SessionRequest(BaseModel):
    session_id: str


@app.post("/api/docs/status")
async def docs_status(body: SessionRequest, _token: str = Depends(require_token)):
    session = _sessions.get(body.session_id, {})
    loaded = session.get("docs_loaded", False)
    return {"loaded": loaded}


@app.post("/api/docs/load")
async def docs_load(body: SessionRequest, _token: str = Depends(require_token)):
    if body.session_id not in _sessions:
        _sessions[body.session_id] = {}

    try:
        # Just mark as loaded — docs are injected inline in /api/chat
        build_docs_text()  # pre-warm the cache
        _sessions[body.session_id]["docs_loaded"] = True
        return {"success": True, "status": "loaded"}
    except Exception as e:
        return {"success": False, "status": str(e)}


# --- Model info ---

@app.get("/api/model-info")
async def model_info(_token: str = Depends(require_token)):
    return {"model_name": MODEL_NAME}


# --- Session cleanup ---

@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str, _token: str = Depends(require_token)):
    _sessions.pop(session_id, None)
    return {"status": "ok"}


# --- Chat ---

class ChatRequest(BaseModel):
    session_id: str
    user_message: str
    conversation_history: list[dict] = []
    editor_context: str = ""
    terminal_context: str = ""
    language: str = "en"


@app.post("/api/chat")
async def chat(body: ChatRequest, _token: str = Depends(require_token)):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Gemini API key not configured on backend.")

    docs = build_docs_text()
    session = _sessions.setdefault(body.session_id, {"docs_loaded": True})

    # Build the full system instruction with docs embedded
    full_system = (
        SYSTEM_PROMPT
        + "\n\n---\n\n# XRP Library Documentation (use this as your primary reference)\n\n"
        + docs
    )

    # Build conversation turns
    contents = []
    for msg in body.conversation_history:
        role = "model" if msg.get("role") in ("assistant", "model") else "user"
        contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]})

    # Build the final user message with context
    user_parts = []
    if body.editor_context:
        user_parts.append(f"[Current editor code]\n{body.editor_context}\n")
    if body.terminal_context:
        user_parts.append(f"[Recent terminal output]\n{body.terminal_context}\n")
    user_parts.append(body.user_message)

    if body.language != "en":
        user_parts.append(f"\n(Please respond in: {body.language})")

    contents.append({"role": "user", "parts": [{"text": "\n\n".join(user_parts)}]})

    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        system_instruction=full_system,
    )

    async def generate():
        try:
            response = model.generate_content(
                contents,
                stream=True,
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=4096,
                    temperature=0.7,
                ),
            )
            for chunk in response:
                text = chunk.text if hasattr(chunk, "text") and chunk.text else ""
                if text:
                    import json
                    yield f"data: {json.dumps({'type': 'content', 'content': text})}\n\n"
                    await asyncio.sleep(0)  # yield control to event loop
        except Exception as e:
            import json
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Google Auth endpoint (optional — only works if GOOGLE_CLIENT_ID is set)
# ---------------------------------------------------------------------------

@app.get("/google-auth/client-id")
async def google_client_id():
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=404, detail="Google OAuth not configured")
    return {"client_id": GOOGLE_CLIENT_ID}


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "gemini_configured": bool(GEMINI_API_KEY),
        "google_auth_configured": bool(GOOGLE_CLIENT_ID),
        "model": MODEL_NAME,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
