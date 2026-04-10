import { ChatMessage } from './types';
import { StorageKeys } from './localstorage';

/**
 * DirectClaudeClient - calls the Anthropic API directly from the browser.
 * Requires the user to supply their own Claude API key via Settings.
 *
 * Anthropic supports direct browser access with the
 * `anthropic-dangerous-direct-browser-access` header.
 */
export class DirectClaudeClient {
    private readonly apiUrl = 'https://api.anthropic.com/v1/messages';

    private get apiKey(): string {
        return localStorage.getItem(StorageKeys.CLAUDE_API_KEY) ?? '';
    }

    private get model(): string {
        return localStorage.getItem(StorageKeys.CLAUDE_MODEL) ?? 'claude-sonnet-4-6';
    }

    private get systemPrompt(): string {
        return (
            localStorage.getItem(StorageKeys.ADMIN_SYSTEM_PROMPT) ??
            DEFAULT_XRP_SYSTEM_PROMPT
        );
    }

    // Satisfy the same interface used by GeminiClient so ai-chat.tsx needs
    // minimal changes.

    async performHandshake(): Promise<string> {
        return 'direct';
    }

    async getDocsStatus(_sessionId: string): Promise<{ loaded: boolean }> {
        return { loaded: false };
    }

    async loadDocs(_sessionId: string): Promise<{ success: boolean; status: string }> {
        return { success: false, status: 'direct-mode' };
    }

    async getModelName(): Promise<string> {
        return this.model;
    }

    async cleanupSession(_sessionId: string): Promise<void> {
        // Nothing to clean up for direct API calls
    }

    async chatWithContext(
        _sessionId: string,
        userMessage: string,
        conversationHistory: ChatMessage[] = [],
        editorContext: string = '',
        terminalContext: string = '',
        _language: string = 'en',
        onStream?: (content: string) => void,
        signal?: AbortSignal
    ): Promise<string> {
        if (!this.apiKey) {
            throw new Error('Claude API key is not set. Please add your key in Settings → AI.');
        }

        const contextBlocks: string[] = [];
        if (editorContext) contextBlocks.push(`Current editor code:\n\`\`\`python\n${editorContext}\n\`\`\``);
        if (terminalContext) contextBlocks.push(`Recent terminal output:\n\`\`\`\n${terminalContext}\n\`\`\``);
        const contextPrefix = contextBlocks.length > 0 ? contextBlocks.join('\n\n') + '\n\n' : '';

        const messages = [
            ...conversationHistory.map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content,
            })),
            {
                role: 'user' as const,
                content: contextPrefix + userMessage,
            },
        ];

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: 4096,
                system: this.systemPrompt,
                messages,
                stream: true,
            }),
            signal,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Claude API error: ${(err as { error?: { message?: string } }).error?.message ?? response.statusText}`);
        }

        return this.parseSSEStream(response, onStream, signal);
    }

    private async parseSSEStream(
        response: Response,
        onStream?: (content: string) => void,
        signal?: AbortSignal
    ): Promise<string> {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let fullContent = '';

        try {
            while (true) {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const raw = line.slice(6).trim();
                    if (!raw || raw === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                            fullContent += parsed.delta.text;
                            onStream?.(fullContent);
                        }
                    } catch {
                        // ignore malformed lines
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return fullContent;
    }
}

export const DEFAULT_XRP_SYSTEM_PROMPT = `You are XRPCode Buddy, an educational AI assistant integrated into the XRPCode IDE for the XRP (eXperiential Robotics Platform) robot. Your purpose is to help students and educators learn robotics programming.

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

When editor code is provided as context, reference it directly in your response. When terminal output is provided, help debug it.`;
