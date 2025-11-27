// state.js
export function getInitialState() {
    return {
        // --- 状态标志 ---
        isLoggedIn: false,
        isRegistering: false,
        isThinking: false,
        isStreaming: false,
        isLoadingModels: false,
        isTestingConnection: false,

        // --- UI 控制 ---
        showSidebar: true,
        showSettings: false,
        showModelOverview: false,
        isDarkMode: false,
        showAbout: false,
        isUserAtBottom: true,
        showAdvancedApi: false,
        showSystemPromptModal: false,
        lang: localStorage.getItem('app_lang') || 'zh',

        // --- 数据 ---
        authForm: { username: '', password: '' },
        authError: '',
        settings: {
            api_endpoint: 'https://api.openai.com/v1',
            api_key: '',
            model: 'gpt-3.5-turbo',
            system_prompt: 'You are a helpful assistant.',
            user_avatar: '',
            dark_mode: false,
            custom_request_template: '',
            custom_response_path: '',
            context_length: 20,
            use_official_api: false
        },
        useCustomModel: false,
        modelSearchQuery: '',
        modelList: ['gpt-4o', 'gpt-3.5-turbo', 'claude-3-5-sonnet'],
        previousStandardModel: null,

        // --- 会话数据 ---
        sessions: [],
        currentSessionId: null,
        messages: [],

        // --- 付费模式 ---
        paidMode: false,
        userPoints: 0,
        showTopUpModal: false,
        topUpOptions: [
            { points: 1000, price: '¥ 9.9', labelKey: 'pack_fresh' },
            { points: 5000, price: '¥ 39.9', labelKey: 'pack_value' },
            { points: 20000, price: '¥ 99.0', labelKey: 'pack_luxury' }
        ],

        // --- 输入区域 ---
        inputMessage: '',
        attachedFiles: [],
        promptLibrary: [],
        randomPrompts: [],
    };
}