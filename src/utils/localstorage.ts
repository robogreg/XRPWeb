const StorageKeys = {
    LOGLEVEL: 'LogLevel',
    ACTIVETAB: 'ActiveTab',
    EDITORSTORE: 'EditorStores',
    VERSION: 'Version',
    XRPUSER: 'XrpUser',
    GOOUSER: 'GooUser',
    LANGUAGE: 'i18nextLng',
    THEME: 'Theme',
    LAST_GOOGLE_DRIVE_TO_XRP_SAVE_TIME: 'LastGoogleDriveToXrpSaveTime',
    GOOGLE_FIRST_TIME_LOGIN: 'GoogleFirstTimeLogin',
    AI_PROVIDER: 'AiProvider',
    GEMINI_API_KEY: 'GeminiApiKey',
    CLAUDE_API_KEY: 'ClaudeApiKey',
    CLAUDE_MODEL: 'ClaudeModel',
    ADMIN_SYSTEM_PROMPT: 'AdminSystemPrompt',
  } as const;
  
  export type StorageKeysType = (typeof StorageKeys)[keyof typeof StorageKeys];
  
  export { StorageKeys };