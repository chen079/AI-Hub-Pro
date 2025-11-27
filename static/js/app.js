// static/js/app.js
import { getInitialState } from './modules/state.js';
import { computedProps } from './modules/computed.js';
import { markdownMethods } from './modules/markdown.js';
import { authMethods } from './modules/auth.js';
import { chatMethods } from './modules/chat.js';
import { fileMethods } from './modules/files.js';

const { createApp } = Vue;

createApp({
    delimiters: ['[[', ']]'],
    data() {
        return getInitialState();
    },
    computed: {
        ...computedProps
    },
    methods: {
        // 混合所有模块的方法
        ...markdownMethods,
        ...authMethods,
        ...chatMethods,
        ...fileMethods,

        // --- 剩下一些零散的、不值得单独拆分的 UI 辅助方法 ---
        
        // 初始化加载
        updatePromptLibrary() {
            this.promptLibrary = window.PROMPTS[this.lang] || window.PROMPTS['zh'];
        },
        refreshRandomPrompts() {
            const shuffled = [...this.promptLibrary].sort(() => 0.5 - Math.random());
            this.randomPrompts = shuffled.slice(0, 4);
        },
        loadCachedModels() {
            const cached = localStorage.getItem('cached_models');
            if (cached) this.modelList = JSON.parse(cached);
        },

        // UI 切换
        toggleSidebar() { this.showSidebar = !this.showSidebar; },
        toggleSettings() { this.showSettings = !this.showSettings; },
        toggleAbout() { this.showAbout = !this.showAbout; },
        
        toggleDarkMode() {
            this.isDarkMode = !this.isDarkMode;
            this.updateHtmlClass();
            this.saveSettings();
        },
        updateHtmlClass() {
            if (this.isDarkMode) document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
        },
        
        toggleLang() {
            this.lang = this.lang === 'zh' ? 'en' : 'zh';
            localStorage.setItem('app_lang', this.lang);
            this.updatePromptLibrary();
            this.refreshRandomPrompts();
            AppUI.toast(this.t('switched_lang'), 'success');
        },
        
        // 字符串格式化
        formatString(str, ...args) {
            return str.replace(/{(\d+)}/g, (match, number) => {
                return typeof args[number] != 'undefined' ? args[number] : match;
            });
        },
        t(key) {
            return MESSAGES[this.lang][key] || key;
        },

        // 滚动与图片错误
        smartScrollToBottom(force = false) {
            this.$nextTick(() => {
                const c = document.getElementById('chat-container');
                if (c) c.scrollTop = c.scrollHeight;
            });
        },
        handleScroll(e) {
            const el = e.target;
            this.isUserAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 50;
        },
        handleImageError(event) {
            event.target.src = '/static/images/default.svg';
        },

        // 模型相关
        selectModelFromOverview(model) {
            this.settings.model = model;
            this.useCustomModel = false;
            this.showModelOverview = false;
            this.saveSettings();
        },
        async fetchModels(tempParams = null) {
            this.isLoadingModels = true;
            try {
                let res;
                if (tempParams) {
                    res = await AppAPI.fetchModels(tempParams.api_endpoint, tempParams.api_key, tempParams.use_official);
                } else {
                    res = await AppAPI.fetchModels();
                }
                if (res.success) {
                    this.modelList = res.models;
                    localStorage.setItem('cached_models', JSON.stringify(this.modelList));
                    if (tempParams) AppUI.toast(`列表已刷新，加载了 ${this.modelList.length} 个模型`, 'success');
                }
            } finally {
                this.isLoadingModels = false;
            }
        },
        async handleTestConnection() {
            const isUsingOfficial = this.paidMode && this.settings.use_official_api;

            // 防御性检查：非官方模式下检查输入
            if (!isUsingOfficial) {
                if (!this.settings.api_endpoint) {
                    AppUI.toast("请先输入 API Endpoint", 'error'); return;
                }
            }

            this.isTestingConnection = true;
            try {
                // 如果是官方模式，传空给后端，防止误读
                const endpointToSend = isUsingOfficial ? '' : this.settings.api_endpoint;
                const apiKeyToSend = isUsingOfficial ? '' : this.settings.api_key;

                const res = await AppAPI.testConnection(
                    endpointToSend, 
                    apiKeyToSend, 
                    isUsingOfficial
                );

                if (res.success) {
                    AppUI.toast(res.message, 'success');
                    
                    // === 【关键修改】测试成功后，把当前输入框的值传给 fetchModels ===
                    // 这样 fetchModels 就会用新的 Key 去拉列表，而不是读旧数据库
                    this.fetchModels({
                        api_endpoint: endpointToSend,
                        api_key: apiKeyToSend,
                        use_official: isUsingOfficial
                    });
                    
                } else {
                    AppUI.toast(res.message, 'error');
                }
            } catch (e) {
                AppUI.toast("请求发送失败", 'error');
                console.error(e);
            } finally {
                this.isTestingConnection = false;
            }
        },
        toggleDeepThinking() {
            const currentModel = this.settings.model;
            const currentProvider = IconLibrary.identifyProvider(currentModel); // 获取当前厂商 (如 claude, openai)

            // 定义思考模型的关键词
            const thinkingKeywords = ['reason', 'think', 'o1-', 'r1', 'k1'];

            if (this.isDeepThinkingEnabled) {
                // === 场景 A: 当前已经是思考模型，想切回普通版 ===

                // 1. 如果有历史记录且厂商一致，切回去
                if (this.previousStandardModel &&
                    this.modelList.includes(this.previousStandardModel) &&
                    IconLibrary.identifyProvider(this.previousStandardModel) === currentProvider
                ) {
                    this.settings.model = this.previousStandardModel;
                } else {
                    // 2. 否则，在同厂商里找一个非思考模型
                    const standardFallback = this.modelList.find(m => {
                        const p = IconLibrary.identifyProvider(m);
                        const isThinking = thinkingKeywords.some(k => m.toLowerCase().includes(k));
                        return p === currentProvider && !isThinking;
                    });
                    // 3. 如果同厂商没找到，就回退到 GPT-4o 或列表第一个
                    this.settings.model = standardFallback || 'gpt-4o';
                }
            } else {
                // === 场景 B: 当前是普通模型，想开启深度思考 ===
                this.previousStandardModel = currentModel;

                // 1. 在【同厂商】中寻找思考模型 (例如 claude -> claude-3-7-sonnet)
                // 逻辑：必须是同厂商 + 包含思考关键词
                let targetModel = this.modelList.find(m => {
                    const p = IconLibrary.identifyProvider(m);
                    const isThinking = thinkingKeywords.some(k => m.toLowerCase().includes(k));
                    return p === currentProvider && isThinking;
                });

                // 2. 如果同厂商没有思考模型 (比如用 gemini 但列表里只有 o1)，则尝试找任意思考模型
                if (!targetModel) {
                    targetModel = this.modelList.find(m =>
                        thinkingKeywords.some(k => m.toLowerCase().includes(k))
                    );
                }

                if (targetModel) {
                    this.settings.model = targetModel;
                    AppUI.toast(`已开启深度思考模式 (${targetModel})`, 'success');
                } else {
                    AppUI.toast("当前模型列表里未找到支持深度思考的模型 (如 o1, r1, thinking)", 'error');
                }
            }
            this.saveSettings();
        },
        async saveSystemPrompt() {
            try {
                // 保存设置
                await AppAPI.saveSettings(this.settings);
                this.showSystemPromptModal = false;
                AppUI.toast(this.t('save_success'), 'success');

                // 如果当前已经在对话中，可选：发送一条系统消息提示用户
                if (this.messages.length > 0) {
                    this.messages.push({
                        role: 'assistant',
                        content: this.formatString(this.t('sys_prompt_sent'), (this.settings.system_prompt || this.t('default_assistant'))),
                        model: 'System'
                    });
                    this.smartScrollToBottom();
                }
            } catch (e) {
                AppUI.toast(this.t('save_error'), 'error');
                console.error(e);
            }
        },
        async resetApiSettings() {
            // 使用自定义 Confirm
            const confirmed = await AppUI.confirm(this.t('api_reset_confirm'));
            if (!confirmed) return;
            this.settings.custom_request_template = ''; // 空代表使用后端默认
            this.settings.custom_response_path = '';    // 空代表使用后端默认
        },
    },

    mounted() {
        if (window.innerWidth < 768) this.showSidebar = false;
        window.addEventListener('paste', this.handlePaste);
        this.updatePromptLibrary();
        this.refreshRandomPrompts();
        this.checkLoginStatus();
        this.loadCachedModels();
    }
}).mount('#app');