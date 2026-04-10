import { GeminiClient } from './gemini-client';
import { DirectClaudeClient } from './anthropic-client';
import { DirectGeminiClient } from './direct-gemini-client';
import { AIProvider } from './types';
import { StorageKeys } from './localstorage';

/**
 * Returns the correct AI client based on the user's saved provider preference.
 *
 * - PROXY (default): uses the backend FastAPI proxy (existing GeminiClient)
 * - GEMINI: calls the Gemini REST API directly with the user's key
 * - CLAUDE: calls the Anthropic API directly with the user's key
 */
export function createAIClient(): GeminiClient | DirectClaudeClient | DirectGeminiClient {
    const provider = localStorage.getItem(StorageKeys.AI_PROVIDER) as AIProvider | null;

    switch (provider) {
        case AIProvider.CLAUDE:
            return new DirectClaudeClient();
        case AIProvider.GEMINI:
            return new DirectGeminiClient();
        default:
            return new GeminiClient();
    }
}

export function getStoredProvider(): AIProvider {
    return (localStorage.getItem(StorageKeys.AI_PROVIDER) as AIProvider) ?? AIProvider.PROXY;
}
