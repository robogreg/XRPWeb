import { ChatMessage } from './types';
import { StorageKeys } from './localstorage';
import { DEFAULT_XRP_SYSTEM_PROMPT } from './anthropic-client';

interface GeminiPart { text: string }
interface GeminiContent { role: string; parts: GeminiPart[] }

/**
 * DirectGeminiClient - calls the Gemini REST API directly from the browser
 * using the user's own API key. Bypasses the backend proxy entirely.
 */
export class DirectGeminiClient {
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

    private get apiKey(): string {
        return localStorage.getItem(StorageKeys.GEMINI_API_KEY) ?? '';
    }

    private get model(): string {
        return 'gemini-2.5-flash';
    }

    private get systemPrompt(): string {
        return (
            localStorage.getItem(StorageKeys.ADMIN_SYSTEM_PROMPT) ??
            DEFAULT_XRP_SYSTEM_PROMPT
        );
    }

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
            throw new Error('Gemini API key is not set. Please add your key in Settings → AI.');
        }

        const contextBlocks: string[] = [];
        if (editorContext) contextBlocks.push(`Current editor code:\n\`\`\`python\n${editorContext}\n\`\`\``);
        if (terminalContext) contextBlocks.push(`Recent terminal output:\n\`\`\`\n${terminalContext}\n\`\`\``);
        const contextPrefix = contextBlocks.length > 0 ? contextBlocks.join('\n\n') + '\n\n' : '';

        const contents: GeminiContent[] = [
            ...conversationHistory.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            })),
            {
                role: 'user',
                parts: [{ text: contextPrefix + userMessage }],
            },
        ];

        const url = `${this.baseUrl}/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: this.systemPrompt }] },
                contents,
            }),
            signal,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const detail = (err as { error?: { message?: string } }).error?.message ?? response.statusText;
            throw new Error(`Gemini API error: ${detail}`);
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
                        const text: string =
                            parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                        if (text) {
                            fullContent += text;
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
