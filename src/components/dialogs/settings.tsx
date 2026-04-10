import { useState } from 'react';
import { StorageKeys } from '@/utils/localstorage';
import { useLocalStorage } from 'usehooks-ts';
import DialogFooter from '@components/dialogs/dialog-footer';
import AppMgr, { Themes } from '@/managers/appmgr';
import { useTranslation } from 'react-i18next';
import TabList from '../tab-list';
import TabItem from '../tab-item';
import AnimatedThemeToggle from '@/widgets/animated-theme-toggle';
import { AIProvider } from '@/utils/types';
import { DEFAULT_XRP_SYSTEM_PROMPT } from '@/utils/anthropic-client';

// Simple admin password — change this constant to set a new password.
const ADMIN_PASSWORD = 'xrpbuddy';

const CLAUDE_MODELS = [
    { value: 'claude-opus-4-6',    label: 'Claude Opus 4.6 (most capable)' },
    { value: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6 (recommended)' },
    { value: 'claude-haiku-4-5-20251001',   label: 'Claude Haiku 4.5 (fastest)' },
];

type SettingsProps = {
    toggleDialog: () => void;
};

function SettingsDlg({ toggleDialog }: SettingsProps) {
    const { t, i18n } = useTranslation();
    const [, setTheme] = useLocalStorage(StorageKeys.THEME, Themes.LIGHT);

    // AI settings
    const [aiProvider, setAiProvider] = useLocalStorage<AIProvider>(StorageKeys.AI_PROVIDER, AIProvider.PROXY);
    const [geminiKey, setGeminiKey] = useLocalStorage(StorageKeys.GEMINI_API_KEY, '');
    const [claudeKey, setClaudeKey] = useLocalStorage(StorageKeys.CLAUDE_API_KEY, '');
    const [claudeModel, setClaudeModel] = useLocalStorage(StorageKeys.CLAUDE_MODEL, 'claude-sonnet-4-6');
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
    const [testError, setTestError] = useState('');

    // Admin settings
    const [adminPassword, setAdminPassword] = useState('');
    const [adminUnlocked, setAdminUnlocked] = useState(false);
    const [adminWrongPw, setAdminWrongPw] = useState(false);
    const [systemPrompt, setSystemPrompt] = useLocalStorage(StorageKeys.ADMIN_SYSTEM_PROMPT, DEFAULT_XRP_SYSTEM_PROMPT);
    const [promptSaved, setPromptSaved] = useState(false);

    const languageOptions = [
        { code: 'en', label: 'English', nativeName: 'English' },
        { code: 'es', label: 'Spanish', nativeName: 'Español' },
    ];

    const inputClass =
        'block w-full rounded border border-shark-300 bg-mountain-mist-100 p-2.5 text-sm text-mountain-mist-700 dark:border-shark-600 dark:bg-shark-500 dark:text-mountain-mist-200 dark:placeholder-mountain-mist-400';

    const labelClass = 'text-sm font-medium text-mountain-mist-900 dark:text-curious-blue-100';

    const handleLanguageChange = (event: { target: { value: string } }) => {
        i18n.changeLanguage(event.target.value);
    };

    const onThemeToggle = (state: Themes) => {
        if (state === Themes.DARK) {
            document.documentElement.classList.add(Themes.DARK);
            document.documentElement.classList.remove(Themes.LIGHT);
        } else {
            document.documentElement.classList.add(Themes.LIGHT);
            document.documentElement.classList.remove(Themes.DARK);
        }
        setTheme(state);
        AppMgr.getInstance().setTheme(state);
    };

    const handleSave = async () => {
        toggleDialog();
    };

    // --- AI Tab ---

    const handleTestConnection = async () => {
        setTestStatus('testing');
        setTestError('');
        try {
            if (aiProvider === AIProvider.CLAUDE) {
                if (!claudeKey) throw new Error('No Claude API key entered.');
                const resp = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': claudeKey,
                        'anthropic-version': '2023-06-01',
                        'anthropic-dangerous-direct-browser-access': 'true',
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: claudeModel,
                        max_tokens: 5,
                        messages: [{ role: 'user', content: 'Hi' }],
                    }),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error((err as { error?: { message?: string } }).error?.message ?? resp.statusText);
                }
            } else if (aiProvider === AIProvider.GEMINI) {
                if (!geminiKey) throw new Error('No Gemini API key entered.');
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: 'Hi' }] }] }),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error((err as { error?: { message?: string } }).error?.message ?? resp.statusText);
                }
            } else {
                throw new Error('Select Gemini or Claude to test a direct connection.');
            }
            setTestStatus('ok');
        } catch (e) {
            setTestStatus('error');
            setTestError(e instanceof Error ? e.message : String(e));
        }
    };

    // --- Admin Tab ---

    const handleAdminUnlock = () => {
        if (adminPassword === ADMIN_PASSWORD) {
            setAdminUnlocked(true);
            setAdminWrongPw(false);
        } else {
            setAdminWrongPw(true);
        }
    };

    const handleSavePrompt = () => {
        setSystemPrompt(systemPrompt);
        setPromptSaved(true);
        setTimeout(() => setPromptSaved(false), 2000);
    };

    const handleResetPrompt = () => {
        setSystemPrompt(DEFAULT_XRP_SYSTEM_PROMPT);
    };

    return (
        <div className="flex flex-col items-center gap-4 rounded-md border border-mountain-mist-700 p-8 shadow-md transition-all dark:border-shark-500 dark:bg-shark-950">
            <div className="flex w-[80%] flex-col items-center">
                <h1 className="text-lg font-bold text-mountain-mist-700 dark:text-mountain-mist-300">{t('settings')}</h1>
                <p className="text-sm text-mountain-mist-700 dark:text-mountain-mist-300">{t('settingDescription')}</p>
            </div>
            <hr className="w-full border-mountain-mist-600" />

            <TabList activeTabIndex={0}>

                {/* Language Tab */}
                <TabItem label={t('language')} isActive={false}>
                    <div className="flex w-full flex-col gap-2 mt-2">
                        <span className={labelClass}>{t('languageSelection')}</span>
                        <select
                            id="languageSelectedId"
                            className={inputClass}
                            value={i18n.language}
                            onChange={handleLanguageChange}
                        >
                            {languageOptions.map((option) => (
                                <option key={option.code} value={option.code}>
                                    {option.nativeName} ({option.label})
                                </option>
                            ))}
                        </select>
                    </div>
                </TabItem>

                {/* Theme Tab */}
                <TabItem label={t('theme.label')} isActive={false}>
                    <div className="flex w-full flex-col gap-2 mt-2">
                        <AnimatedThemeToggle
                            labelLeft={t('theme.light')}
                            labelRight={t('theme.dark')}
                            initial={document.documentElement.classList.contains('dark')}
                            onToggle={onThemeToggle}
                        />
                    </div>
                </TabItem>

                {/* AI Tab */}
                <TabItem label="AI" isActive={false}>
                    <div className="flex w-full flex-col gap-4 mt-2 min-w-[340px]">
                        {/* Provider selector */}
                        <div className="flex flex-col gap-1">
                            <label className={labelClass}>AI Provider</label>
                            <select
                                className={inputClass}
                                value={aiProvider}
                                onChange={e => { setAiProvider(e.target.value as AIProvider); setTestStatus('idle'); }}
                            >
                                <option value={AIProvider.PROXY}>Backend Proxy (default)</option>
                                <option value={AIProvider.GEMINI}>Gemini (direct, your key)</option>
                                <option value={AIProvider.CLAUDE}>Claude / Anthropic (direct, your key)</option>
                            </select>
                            {aiProvider === AIProvider.PROXY && (
                                <p className="text-xs text-mountain-mist-500 dark:text-mountain-mist-400 mt-1">
                                    Uses the hosted backend service. No API key needed.
                                </p>
                            )}
                        </div>

                        {/* Gemini key */}
                        {aiProvider === AIProvider.GEMINI && (
                            <div className="flex flex-col gap-1">
                                <label className={labelClass}>Gemini API Key</label>
                                <input
                                    type="password"
                                    className={inputClass}
                                    placeholder="AIza..."
                                    value={geminiKey}
                                    onChange={e => setGeminiKey(e.target.value)}
                                />
                                <p className="text-xs text-mountain-mist-500 dark:text-mountain-mist-400">
                                    Get a free key at <span className="font-mono">aistudio.google.com</span>
                                </p>
                            </div>
                        )}

                        {/* Claude key + model */}
                        {aiProvider === AIProvider.CLAUDE && (
                            <>
                                <div className="flex flex-col gap-1">
                                    <label className={labelClass}>Claude API Key</label>
                                    <input
                                        type="password"
                                        className={inputClass}
                                        placeholder="sk-ant-..."
                                        value={claudeKey}
                                        onChange={e => setClaudeKey(e.target.value)}
                                    />
                                    <p className="text-xs text-mountain-mist-500 dark:text-mountain-mist-400">
                                        Get a key at <span className="font-mono">console.anthropic.com</span>
                                    </p>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className={labelClass}>Claude Model</label>
                                    <select
                                        className={inputClass}
                                        value={claudeModel}
                                        onChange={e => setClaudeModel(e.target.value)}
                                    >
                                        {CLAUDE_MODELS.map(m => (
                                            <option key={m.value} value={m.value}>{m.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}

                        {/* Test connection */}
                        {aiProvider !== AIProvider.PROXY && (
                            <div className="flex flex-col gap-1">
                                <button
                                    onClick={handleTestConnection}
                                    disabled={testStatus === 'testing'}
                                    className="rounded bg-curious-blue-600 px-3 py-1.5 text-sm text-white hover:bg-curious-blue-700 disabled:opacity-50"
                                >
                                    {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
                                </button>
                                {testStatus === 'ok' && (
                                    <p className="text-xs text-green-600 dark:text-green-400">Connection successful!</p>
                                )}
                                {testStatus === 'error' && (
                                    <p className="text-xs text-red-600 dark:text-red-400">{testError}</p>
                                )}
                            </div>
                        )}
                    </div>
                </TabItem>

                {/* Admin Tab */}
                <TabItem label="Admin" isActive={false}>
                    <div className="flex w-full flex-col gap-4 mt-2 min-w-[340px]">
                        {!adminUnlocked ? (
                            <div className="flex flex-col gap-2">
                                <label className={labelClass}>Admin Password</label>
                                <input
                                    type="password"
                                    className={inputClass}
                                    placeholder="Enter admin password"
                                    value={adminPassword}
                                    onChange={e => { setAdminPassword(e.target.value); setAdminWrongPw(false); }}
                                    onKeyDown={e => e.key === 'Enter' && handleAdminUnlock()}
                                />
                                {adminWrongPw && (
                                    <p className="text-xs text-red-600 dark:text-red-400">Incorrect password.</p>
                                )}
                                <button
                                    onClick={handleAdminUnlock}
                                    className="rounded bg-curious-blue-600 px-3 py-1.5 text-sm text-white hover:bg-curious-blue-700"
                                >
                                    Unlock
                                </button>
                                <p className="text-xs text-mountain-mist-500 dark:text-mountain-mist-400">
                                    Default password: <span className="font-mono">xrpbuddy</span>. Change the <span className="font-mono">ADMIN_PASSWORD</span> constant in <span className="font-mono">settings.tsx</span> before deployment.
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <label className={labelClass}>XRP Buddy System Prompt</label>
                                    <span className="text-xs text-green-600 dark:text-green-400">Unlocked</span>
                                </div>
                                <p className="text-xs text-mountain-mist-500 dark:text-mountain-mist-400">
                                    This prompt is used when <strong>Gemini Direct</strong> or <strong>Claude</strong> is selected as the AI provider. The backend proxy uses its own prompt.
                                </p>
                                <textarea
                                    className={`${inputClass} font-mono text-xs leading-relaxed`}
                                    rows={12}
                                    value={systemPrompt}
                                    onChange={e => setSystemPrompt(e.target.value)}
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleSavePrompt}
                                        className="rounded bg-curious-blue-600 px-3 py-1.5 text-sm text-white hover:bg-curious-blue-700"
                                    >
                                        {promptSaved ? 'Saved!' : 'Save Prompt'}
                                    </button>
                                    <button
                                        onClick={handleResetPrompt}
                                        className="rounded border border-mountain-mist-400 px-3 py-1.5 text-sm text-mountain-mist-700 hover:bg-mountain-mist-100 dark:border-shark-500 dark:text-mountain-mist-300 dark:hover:bg-shark-700"
                                    >
                                        Restore Default
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </TabItem>

            </TabList>

            <hr className="w-full border-mountain-mist-600" />
            <DialogFooter
                btnAcceptLabel={t('save')}
                btnAcceptCallback={handleSave}
                btnCancelCallback={toggleDialog}
            />
        </div>
    );
}

export default SettingsDlg;
