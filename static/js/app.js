// static/js/app.js
window.copyCodeBlock = async (btn) => {
    const wrapper = btn.closest('.code-block-wrapper');
    const codeBlock = wrapper.querySelector('code');
    if (!codeBlock) return;

    const text = codeBlock.innerText;

    // === 直接调用公共工具 ===
    const success = await AppClipboard.copy(text);

    if (success) {
        // UI 反馈逻辑保持不变
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.classList.add('text-green-500');
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('text-green-500');
        }, 2000);
    } else {
        const lang = localStorage.getItem('app_lang') || 'zh';
        AppUI.toast(window.MESSAGES[lang]['copy_fail_alert'] || 'Copy failed', 'error');
    }
};

const { createApp } = Vue;

createApp({
    delimiters: ['[[', ']]'],
    data() {
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
            showModelOverview: false, // [新增] 控制模型概览弹窗
            isDarkMode: false,
            showAbout: false, // [新增] 控制关于弹窗显示
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
                // [新增] 自定义 API 字段
                custom_request_template: '',
                custom_response_path: '',
                context_length: 20,
                use_official_api: false // 【新增】初始化为 false
            },

            useCustomModel: false, // [新增]
            modelSearchQuery: '',  // [新增] 搜索关键词
            modelList: ['gpt-4o', 'gpt-3.5-turbo', 'claude-3-5-sonnet'],
            previousStandardModel: null, // [新增] 用于深度思考切换回退

            // --- 会话数据 ---
            sessions: [],
            currentSessionId: null,
            messages: [],

            // 【新增】付费模式相关
            paidMode: false,
            userPoints: 0,
            showTopUpModal: false, // 控制充值弹窗
            topUpOptions: [
                { points: 1000, price: '¥ 9.9', labelKey: 'pack_fresh' },
                { points: 5000, price: '¥ 39.9', labelKey: 'pack_value' },
                { points: 20000, price: '¥ 99.0', labelKey: 'pack_luxury' }
            ],

            // --- 输入区域 ---
            inputMessage: '',
            attachedFiles: [],
            // 【新增】提示词库数组
            promptLibrary: [],
            randomPrompts: [], // 【新增】用于当前显示的随机数据
        }
    },

    mounted() {
        // 移动端自动收起侧边栏
        if (window.innerWidth < 768) this.showSidebar = false;

        // 监听粘贴事件 (支持粘贴截图)
        window.addEventListener('paste', this.handlePaste);

        // 初始化
        this.updatePromptLibrary(); // 初始化加载提示词库
        this.refreshRandomPrompts();
        this.checkLoginStatus();
        this.loadCachedModels();
    },

    computed: {
        isNewChatMode() {
            return !this.currentSessionId || (this.messages.length === 0 && !this.isThinking);
        },
        currentSessionTitle() {
            const s = this.sessions.find(x => x.id === this.currentSessionId);
            return s ? s.title : '新对话';
        },
        totalSessionTokens() {
            if (!this.messages || this.messages.length === 0) return 0;
            return this.messages.reduce((acc, msg) => {
                // 累加每一条消息的 token (包括 user 和 assistant)
                return acc + this.estimateTokens(msg.content);
            }, 0);
        },
        // [核心修复]：分组模型逻辑
        groupedModels() {
            const groups = {};
            if (!this.modelList || this.modelList.length === 0) return groups;

            // 1. 搜索过滤
            const query = this.modelSearchQuery.toLowerCase();
            const filteredList = this.modelList.filter(m =>
                m.toLowerCase().includes(query)
            );

            // 2. 分组
            filteredList.forEach(model => {
                // 调用 utils.js 中的 IconLibrary
                let providerId = IconLibrary.identifyProvider(model);
                // 首字母大写作为标题
                let groupTitle = providerId.charAt(0).toUpperCase() + providerId.slice(1);

                if (!groups[groupTitle]) {
                    groups[groupTitle] = [];
                }
                groups[groupTitle].push(model);
            });

            // 3. 排序 (按厂商名字母序)
            return Object.keys(groups).sort().reduce((acc, key) => {
                acc[key] = groups[key];
                return acc;
            }, {});
        },

        // [新增] 深度思考模式判断
        isDeepThinkingEnabled() {
            const m = this.settings.model.toLowerCase();
            const keywords = ['reason', 'think', 'o1-', 'r1'];
            return keywords.some(k => m.includes(k));
        }
    },

    methods: {
        updatePromptLibrary() {
            this.promptLibrary = window.PROMPTS[this.lang] || window.PROMPTS['zh'];
        },
        // 【新增】Token 估算算法
        estimateTokens(text) {
            if (!text) return 0;
            // 1. 统计中文字符 (CJK)
            // 中文通常占 1.5 ~ 2 个 Token，这里取 1.6 做估算
            const cjkMatch = text.match(/[\u4e00-\u9fa5]/g);
            const cjkCount = cjkMatch ? cjkMatch.length : 0;

            // 2. 统计非中文字符 (英文、数字、符号)
            // 英文通常 4 个字符 = 1 Token，即 0.25
            const otherCount = text.length - cjkCount;

            // 3. 计算总和 (向上取整)
            return Math.ceil(cjkCount * 1.6 + otherCount * 0.25);
        },
        // ===========================
        // 1. 认证与设置模块
        // ===========================
        async checkLoginStatus() {
            try {
                const settings = await AppAPI.getSettings();
                if (settings) {
                    this.isLoggedIn = true;
                    this.applySettings(settings);
                    if (this.authForm.username) await this.loadSessions();

                    // 获取付费状态和余额
                    this.fetchUserStatus();
                }
            } catch (e) {
                console.log("Not logged in");
            }
        },

        // 【新增】获取用户状态
        async fetchUserStatus() {
            try {
                const res = await AppAPI.request('/api/user_status');
                this.paidMode = res.paid_mode;
                this.userPoints = res.points;
            } catch (e) { console.error(e); }
        },

        // 【新增】模拟充值
        async handleTopUp(amount) {
            const title = this.t('confirm_pay');
            const content = this.formatString(this.t('confirm_pay_text'), amount);
            const confirmed = await AppUI.confirm(title, content);
            if (!confirmed) return;

            try {
                const res = await AppAPI.request('/api/add_points', 'POST', { amount });
                if (res.success) {
                    this.userPoints = res.new_balance;
                    AppUI.toast(this.formatString(this.t('pay_success'), res.new_balance), 'success');
                    this.showTopUpModal = false;
                }
            } catch (e) {
                AppUI.toast(this.t('pay_fail'), 'error');
            }
        },

        async handleAuth() {
            if (!this.authForm.username || !this.authForm.password) {
                this.authError = this.t('input_missing'); return;
            }
            try {
                const res = this.isRegistering
                    ? await AppAPI.register(this.authForm.username, this.authForm.password)
                    : await AppAPI.login(this.authForm.username, this.authForm.password);

                if (res.success) {
                    if (this.isRegistering) {
                        this.isRegistering = false;
                        this.authForm.password = '';
                        AppUI.toast(this.t('reg_success_login'), 'success');
                    } else {
                        this.isLoggedIn = true;
                        this.authError = '';
                        this.checkLoginStatus();
                    }
                } else {
                    this.authError = res.message;
                }
            } catch (e) {
                this.authError = this.t('network_err');
            }
        },

        logout() {
            fetch('/logout').then(() => {
                this.isLoggedIn = false;
                window.location.reload();
            });
        },

        applySettings(data) {
            this.authForm.username = data.account_username;
            delete data.account_username;
            this.settings = { ...this.settings, ...data };

            // 应用暗黑模式
            this.isDarkMode = !!this.settings.dark_mode;
            this.updateHtmlClass();
        },

        // [新增] 1. 复制消息
        async copyMessage(text) {
            // === 直接调用公共工具 ===
            const success = await AppClipboard.copy(text);

            if (success) {
                AppUI.toast(this.t('copy_success'), 'success');
            } else {
                AppUI.toast(this.t('copy_fail_browser'), 'error');
            }
        },

        // [新增] 2. 删除单条消息
        async deleteMessage(index) {
            // 使用自定义 Confirm
            const confirmed = await AppUI.confirm(this.t('delete_confirm_title'), this.t('del_msg_confirm'));
            if (!confirmed) return;

            this.messages.splice(index, 1);
            await this.saveCurrentSessionData();
        },

        // [新增] 3. 编辑消息
        async editMessage(index) {
            const msg = this.messages[index];

            // 使用自定义 Input 弹窗
            const newContent = await AppUI.input(
                this.t('edit_msg_title'),
                msg.content,
                this.t('edit_msg_ph')
            );

            // 如果用户点击确定且内容不为空 (AppUI.input 返回 null 代表取消)
            if (newContent !== null) {
                msg.content = newContent;
                await this.saveCurrentSessionData();
                AppUI.toast(this.t('msg_edited'), 'success');
            }
        },

        // [新增] 4. 重新生成 (高级功能)
        async regenerateResponse(aiIndex) {
            if (this.isThinking || this.isStreaming) return;

            // 1. 找到该消息在数组中的位置
            // 如果传入了 index 就用 index，否则默认重试最后一条
            let targetIndex = aiIndex;
            if (targetIndex === undefined) {
                targetIndex = this.messages.length - 1;
            }

            // 2. 校验：确保它是 AI 的消息
            if (targetIndex < 0 || this.messages[targetIndex].role === 'user') {
                return; // 不能重试用户的消息，除非你只想重发
            }

            // 3. 删除这条 AI 消息
            this.messages.splice(targetIndex, 1);

            // 4. 立即调用核心请求函数
            // streamResponse 会自动读取 this.messages 里的最后一条（即上一条 User 消息）作为 prompt
            await this.streamResponse();
        },

        // [新增] 辅助函数：保存当前会话数据到数据库
        async saveCurrentSessionData() {
            if (this.currentSessionId) {
                const session = this.sessions.find(s => s.id === this.currentSessionId);
                if (session) {
                    session.messages = this.messages;
                    await AppDB.saveSession(session);
                }
            }
        },

        // [新增] 重命名当前会话
        async renameSession(id) {
            // 1. 找到对应的会话对象
            const session = this.sessions.find(s => s.id === id);
            if (!session) return;

            // 2. 弹出自定义输入框
            const newTitle = await AppUI.input(
                this.t('rename_title'),
                session.title,
                this.t('rename_ph')
            );

            // 3. 如果用户输入了内容
            if (newTitle !== null) {
                session.title = newTitle;
                // 保存到 IndexedDB
                await AppDB.saveSession(session);
                AppUI.toast(this.t('rename_success'), 'success');
            }
        },

        // [新增] 处理测试连接
        async handleTestConnection() {
            // 判断当前是否开启了官方模式
            const isUsingOfficial = this.paidMode && this.settings.use_official_api;

            // 只有在使用自定义配置时，才校验输入框
            if (!isUsingOfficial) {
                if (!this.settings.api_endpoint) {
                    AppUI.toast("请先输入 API Endpoint", 'error');
                    return;
                }
                // 允许 Key 为空(测试已保存的)，但如果都没填提示一下
                if (!this.settings.api_endpoint) {
                    AppUI.toast("请输入配置信息", 'error'); return;
                }
            }

            this.isTestingConnection = true;
            try {
                // 传入第三个参数 isUsingOfficial
                const res = await AppAPI.testConnection(
                    this.settings.api_endpoint,
                    this.settings.api_key,
                    isUsingOfficial
                );

                if (res.success) {
                    AppUI.toast(res.message, 'success');
                    // 测试成功后自动刷新模型列表
                    this.fetchModels();
                } else {
                    AppUI.toast(res.message, 'error');
                }
            } catch (e) {
                AppUI.toast("请求发送失败，请检查网络连接", 'error');
                console.error(e);
            } finally {
                this.isTestingConnection = false;
            }
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
        async saveSettings() {
            this.settings.dark_mode = this.isDarkMode;
            await AppAPI.saveSettings(this.settings);
            this.showSettings = false;
        },

        toggleDarkMode() {
            this.isDarkMode = !this.isDarkMode;
            this.updateHtmlClass();
            this.saveSettings();
        },

        updateHtmlClass() {
            if (this.isDarkMode) document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
        },

        // ===========================
        // 2. 会话管理模块 (IndexedDB)
        // ===========================
        async loadSessions() {
            this.sessions = await AppDB.getAllByUsername(this.authForm.username);
            this.sessions.sort((a, b) => b.created_at - a.created_at);
            if (this.sessions.length === 0) this.startNewChat();
        },

        async createSessionObject(title) {
            const newSession = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2),
                username: this.authForm.username,
                title: title.substring(0, 30) || '新对话',
                created_at: Date.now(),
                messages: []
            };
            this.sessions.unshift(newSession);
            this.currentSessionId = newSession.id;
            this.messages = newSession.messages;
            await AppDB.saveSession(newSession);
            return newSession;
        },

        selectSession(id) {
            this.currentSessionId = id;
            const session = this.sessions.find(s => s.id === id);
            this.messages = session ? session.messages : [];
            this.smartScrollToBottom(true);
            if (window.innerWidth < 768) this.showSidebar = false;
        },

        // 【新增】切换语言方法
        toggleLang() {
            this.lang = this.lang === 'zh' ? 'en' : 'zh';
            localStorage.setItem('app_lang', this.lang);
            this.updatePromptLibrary(); // 更新库
            this.refreshRandomPrompts(); // 刷新显示
            AppUI.toast(this.t('switched_lang'), 'success');
        },

        formatString(str, ...args) {
            return str.replace(/{(\d+)}/g, (match, number) => {
                return typeof args[number] != 'undefined' ? args[number] : match;
            });
        },

        // 【新增】核心翻译函数
        t(key) {
            // 从全局变量 MESSAGES 中获取
            // 如果找不到 key，就直接显示 key，方便调试
            return MESSAGES[this.lang][key] || key;
        },

        startNewChat() {
            this.currentSessionId = null;
            this.messages = [];
            this.inputMessage = '';
            this.attachedFiles = [];

            // 【新增】强制重置状态，防止之前的对话卡住
            this.isThinking = false;
            this.isStreaming = false;

            if (window.innerWidth < 768) this.showSidebar = false;
        },

        async deleteSession(id) {
            const isConfirmed = await AppUI.confirm(this.t('del_session_title'), this.t('del_session_desc'));
            if (!isConfirmed) return;
            await AppDB.deleteSession(id);
            AppUI.toast('删除成功', 'success');
            await AppDB.deleteSession(id);
            this.sessions = this.sessions.filter(s => s.id !== id);
            if (this.currentSessionId === id) this.startNewChat();
        },

        toggleAbout() {
            this.showAbout = !this.showAbout;
        },

        // 1. 处理图片加载错误 (显示默认图)
        handleImageError(event) {
            event.target.src = '/static/images/default.svg';
        },

        // 2. 从概览中选择模型
        selectModelFromOverview(model) {
            this.settings.model = model;
            this.useCustomModel = false;
            this.showModelOverview = false;
            this.saveSettings();
        },

        refreshRandomPrompts() {
            // 洗牌算法
            const shuffled = [...this.promptLibrary].sort(() => 0.5 - Math.random());
            // 取前 4 个显示
            this.randomPrompts = shuffled.slice(0, 4);
        },

        // 3. 切换深度思考 (Deep Thinking)
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

        async resetApiSettings() {
            // 使用自定义 Confirm
            const confirmed = await AppUI.confirm(this.t('api_reset_confirm'));
            if (!confirmed) return;
            this.settings.custom_request_template = ''; // 空代表使用后端默认
            this.settings.custom_response_path = '';    // 空代表使用后端默认
        },

        // ===========================
        // 3. 聊天核心逻辑
        // ===========================

        // [新增] 核心：处理 API 请求与流式响应
        async streamResponse() {
            if (this.isThinking) return;

            // ================= [新增] 发送前余额检查 =================
            if (this.paidMode && this.userPoints <= 0) {
                AppUI.toast("点数不足，请先充值！", 'error');
                this.showTopUpModal = true;
                return;
            }
            // ======================================================

            this.isThinking = true;
            this.isStreaming = false; // 准备开始流传输

            // 1. 构建 API 消息格式 (OpenAI 兼容)
            let maxHistory = this.settings.context_length;
            if (maxHistory === undefined || maxHistory === null) maxHistory = 20;

            // 1. 获取需要发送的消息切片
            // 如果 maxHistory 为 0，slice(-0) 会返回空数组，符合"单轮对话"逻辑(只发当前这一条)
            // 但我们需要保留当前的最后一条用户消息，所以逻辑稍微调整：

            let messagesToSend = [];

            if (maxHistory > 0) {
                // 正常截取历史
                messagesToSend = this.messages.slice(-maxHistory);
            } else {
                // 如果设置为 0，只发送最后一条 (即本次用户的提问)
                messagesToSend = this.messages.slice(-1);
            }

            // 2. 构建 API 消息格式 (基于切片后的数据 map)
            const apiMessages = messagesToSend.map((msg, index) => {
                // 判断逻辑：如果是切片后的最后一条，且是用户消息...
                const isLastUserMsg = (msg.role === 'user' && index === messagesToSend.length - 1);
                const hasFiles = msg.files && msg.files.length > 0;

                // 构建发送给 AI 的实际文本 (文本 + 隐藏的文档内容)
                let contentToSend = msg.content;
                if (msg.role === 'user' && msg.parsed_context) {
                    contentToSend += "\n" + msg.parsed_context;
                }

                // 处理多模态 (图片)
                if (isLastUserMsg && hasFiles) {
                    const contentParts = [];
                    if (contentToSend) contentParts.push({ type: "text", text: contentToSend });

                    msg.files.forEach(f => {
                        if (f.type === 'image') {
                            // 图片转 Base64 逻辑
                            contentParts.push({ type: "image_url", image_url: { url: f.content, detail: "auto" } });
                        }
                    });

                    // 格式修正：如果只有纯文本，不要包在数组里 (兼容性更好)
                    if (contentParts.length === 1 && contentParts[0].type === 'text') {
                        return { role: msg.role, content: contentParts[0].text };
                    }
                    return { role: msg.role, content: contentParts };
                }

                // 历史消息只传文本
                return { role: msg.role, content: contentToSend };
            });

            // 2. 准备接收回复
            let aiMsgIndex = -1; // 标记 AI 消息在数组中的位置

            await AppAPI.chatStream({ messages: apiMessages }, {
                onChunk: (text) => {
                    this.isThinking = false; // 第一帧到达，停止思考动画
                    this.isStreaming = true; // 开始流式传输状态

                    // 如果是第一帧，创建 AI 消息气泡
                    if (aiMsgIndex === -1) {
                        this.messages.push({ role: 'assistant', content: '', model: this.settings.model });
                        aiMsgIndex = this.messages.length - 1;
                    }

                    this.messages[aiMsgIndex].content += text;
                    if (this.isUserAtBottom) this.smartScrollToBottom();
                },
                onDone: async () => {
                    this.isThinking = false;
                    this.isStreaming = false;

                    // ================= [新增] 刷新余额 =================
                    // 对话成功结束后，向后端拉取最新的余额（因为后端已经扣费）
                    if (this.paidMode) {
                        this.fetchUserStatus();
                    }
                    // =================================================

                    // 保存会话
                    if (this.currentSessionId) {
                        const session = this.sessions.find(s => s.id === this.currentSessionId);
                        if (session) {
                            session.messages = this.messages;
                            await AppDB.saveSession(session);
                        }
                    }
                    this.smartScrollToBottom();
                },
                // ================= 【修复点 2】 =================
                onError: async (err) => { // 注意：加上 async
                    this.isThinking = false;
                    this.isStreaming = false;

                    // 错误处理逻辑 (402 等)
                    if (err.includes("402") || err.includes("点数不足")) {
                        this.messages.push({
                            role: 'assistant',
                            content: `**${this.t('bal_warning_title')}**\n\n${this.formatString(this.t('bal_warning_content'), err)}`,
                            model: 'System'
                        });
                        this.showTopUpModal = true;
                    } else {
                        this.messages.push({ role: 'assistant', content: `Error: ${err}`, model: 'System' });
                    }

                    // 重点：出错后也要保存会话！这样刷新后能在历史记录看到报错信息
                    await this.saveCurrentSessionData();

                    this.smartScrollToBottom();
                }
            });
        },

        // [重构] 发送消息入口
        async sendMessage() {
            // 校验
            if ((!this.inputMessage.trim() && this.attachedFiles.length === 0) || this.isThinking) return;

            const textContent = this.inputMessage;
            const currentFiles = [...this.attachedFiles];

            // 清空输入
            this.inputMessage = '';
            this.attachedFiles = [];

            // 1. 获取或创建会话
            if (!this.currentSessionId) {
                await this.createSessionObject(textContent || '媒体消息');
            }

            // 2. [文档解析]
            // 如果有文档，先解析并将文本附加到 prompt 中
            // 注意：为了让“重新生成”也能带上文档内容，我们直接把解析后的文本拼接到消息里
            // 2. [文档解析]
            // 如果有文档，先解析并将文本附加到 prompt 中
            let finalPrompt = textContent;

            // 【新增变量】专门用来存解析后的长文本
            let fullDocText = "";

            const docFiles = currentFiles.filter(f => f.type === 'doc');

            if (docFiles.length > 0) {
                // 临时显示提示
                const loadingMsgIndex = this.messages.push({ role: 'assistant', content: this.t('parsing_doc'), model: 'System' }) - 1;
                this.smartScrollToBottom();

                for (let fileObj of docFiles) {
                    const extractedText = await AppAPI.parseDocument(fileObj.raw);
                    if (extractedText) {
                        // 【修改点】不再拼接到 finalPrompt，而是拼接到 fullDocText
                        fullDocText += `\n\n--- Document: ${fileObj.name} ---\n${extractedText}\n----------------\n`;
                    }
                }
                // 移除临时提示
                this.messages.splice(loadingMsgIndex, 1);
            }

            // 3. 推送用户消息上屏
            const userMsg = {
                role: 'user',
                content: finalPrompt, // 这里只放用户输入的话 (例如："阅读这篇文献...")

                // 【新增字段】这里存放不显示的文档全文，Saved in DB automatically
                parsed_context: fullDocText,

                files: currentFiles,
                model: this.settings.model
            };
            this.messages.push(userMsg);
            this.smartScrollToBottom(true);

            // 用户发完消息立刻保存
            await this.saveCurrentSessionData();

            // 4. 调用核心流式请求
            await this.streamResponse();
        },

        // ===========================
        // 4. 辅助功能 (渲染、滚动、文件)
        // ===========================
        // [修改] static/js/app.js 中的 renderContent 函数
        renderContent(text) {
            if (!text) return '';

            let processed = text;

            // === 修复深度思考渲染 ===

            // 1. 处理【完整】的思考块 <think>...</think>
            // 使用非贪婪匹配，处理中间的内容
            processed = processed.replace(
                /<think>([\s\S]*?)<\/think>/g,
                '<details class="think-block"><summary>深度思考过程</summary><div class="content">$1</div></details>'
            );

            // 2. 处理【未闭合】的思考块 (流式输出中，正在思考时)
            // 只要有 <think> 但后面没有 </think>，就视为正在生成
            if (processed.includes('<think>') && !processed.includes('</think>')) {
                processed = processed.replace(
                    /<think>([\s\S]*)/, // 匹配从 <think> 开始到结尾的所有内容
                    '<details class="think-block" open><summary><i class="fas fa-spinner fa-spin mr-1"></i> 思考中...</summary><div class="content animate-pulse">$1</div></details>'
                );
            }

            // 2. 视频优化 (支持 .mp4, .webm, .ogg, .mov)
            processed = processed.replace(
                /!\[(.*?)\]\((.*?\.(?:mp4|webm|ogg|mov)(?:\?.*)?)\)/gi,
                '<div class="media-container video"><video src="$2" controls preload="metadata"></video></div>'
            );

            // 3. 音频优化 (支持 .mp3, .wav, .m4a)
            processed = processed.replace(
                /!\[(.*?)\]\((.*?\.(?:mp3|wav|m4a)(?:\?.*)?)\)/gi,
                '<div class="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 p-2 rounded-lg my-2 border dark:border-gray-700">' +
                '<div class="w-8 h-8 flex items-center justify-center bg-purple-100 text-purple-600 rounded-full flex-shrink-0"><i class="fas fa-music"></i></div>' +
                '<div class="flex-1 min-w-0"><div class="text-xs text-gray-500 mb-1 truncate">$1</div>' +
                '<audio src="$2" controls class="w-full h-8"></audio></div>' +
                '</div>'
            );

            // 4. [新增] Iframe 支持 (用于 PPT 预览、网页预览等)
            // 警告：仅对可信 API 启用此功能。这里将其转换为一个点击加载的按钮以提高安全性
            processed = processed.replace(
                /\[Preview Widget\]\((https?:\/\/.*?\.(?:html|php|aspx).*?)\)/gi,
                '<div class="my-2"><a href="$1" target="_blank" class="text-blue-500 underline"><i class="fas fa-external-link-alt"></i> 打开预览页面</a></div>'
            );

            // 5. 链接优化 (让普通链接在新窗口打开)
            const renderer = new marked.Renderer();
            renderer.code = (code, language) => {
                // 处理高亮
                const validLang = !!(language && hljs.getLanguage(language));
                const highlighted = validLang
                    ? hljs.highlight(code, { language }).value
                    : hljs.highlightAuto(code).value;

                // 语言名称 (用于显示)
                const langLabel = language ? language : 'Text';

                // 返回包裹了 Wrapper 和 Button 的 HTML
                return `
                <div class="code-block-wrapper">
                    <span class="code-lang-label">${langLabel}</span>
                    <button class="copy-code-btn" onclick="window.copyCodeBlock(this)">
                        <i class="fas fa-copy"></i> Copy
                    </button>
                    <pre><code class="hljs ${language || ''}">${highlighted}</code></pre>
                </div>
                `;
            };

            // 2. 链接在新窗口打开
            renderer.link = (href, title, text) => {
                return `<a target="_blank" rel="noopener noreferrer" href="${href}" title="${title || ''}">${text}</a>`;
            };

            // 3. 解析 Markdown
            let html = marked.parse(processed, { renderer: renderer });

            return html;
        },

        getModelAvatar(modelName) {
            return IconLibrary.getIcon(modelName);
        },

        // 智能滚动
        handleScroll(e) {
            const el = e.target;
            // 阈值设为 50px，如果在底部附近，则标记为 True
            this.isUserAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 50;
        },

        smartScrollToBottom(force = false) {
            this.$nextTick(() => {
                const c = document.getElementById('chat-container');
                if (c) c.scrollTop = c.scrollHeight;
            });
        },

        // 文件处理
        triggerFileUpload() { document.getElementById('file-input').click(); },

        handleFileSelect(event) {
            this.processFiles(event.target.files);
            event.target.value = '';
        },

        handlePaste(event) {
            if (event.clipboardData && event.clipboardData.files.length > 0) {
                event.preventDefault();
                this.processFiles(event.clipboardData.files);
            }
        },

        processFiles(files) {
            if (!files || files.length === 0) return; // 增加判空

            for (let file of files) {
                // 1. 简单的文件大小限制 (20MB)
                if (file.size > 20 * 1024 * 1024) {
                    AppUI.toast(`文件 ${file.name} 太大，请上传 20MB 以内的文件`, 'error');
                    continue;
                }

                // === 修复开始：增强类型识别逻辑 ===
                let type = 'doc';
                // 获取小写后缀名，例如 'png'
                const ext = file.name.split('.').pop().toLowerCase();

                // 优先检查 MIME type，如果没有则检查后缀名
                if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
                    type = 'image';
                } else if (file.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) {
                    type = 'audio';
                } else if (file.type.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
                    type = 'video';
                }
                // === 修复结束 ===

                // 3. 多媒体文件 (图片/音频/视频) 读取为 Base64
                if (['image', 'audio', 'video'].includes(type)) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        // 使用 this.attachedFiles.push 确保 Vue 能监听到变化
                        this.attachedFiles.push({
                            name: file.name,
                            type: type,
                            content: e.target.result, // Base64
                            raw: file
                        });
                    };
                    reader.readAsDataURL(file);
                } else {
                    // 普通文档
                    this.attachedFiles.push({
                        name: file.name,
                        type: 'doc', // 确保这里是 'doc'
                        content: null,
                        raw: file
                    });
                }
            }
        },

        removeFile(index) {
            this.attachedFiles.splice(index, 1);
        },

        // 设置与模型列表辅助
        toggleSettings() { this.showSettings = !this.showSettings; },

        triggerAvatarUpload() { document.getElementById('avatar-upload-input').click(); },

        async handleAvatarSelect(e) {
            if (e.target.files[0]) {
                const res = await AppAPI.uploadAvatar(e.target.files[0]);
                if (res.success) this.settings.user_avatar = res.avatar;
            }
        },

        async fetchModels() {
            this.isLoadingModels = true;
            try {
                const res = await AppAPI.fetchModels();
                if (res.success) {
                    this.modelList = res.models;
                    localStorage.setItem('cached_models', JSON.stringify(this.modelList));
                }
            } finally {
                this.isLoadingModels = false;
            }
        },

        loadCachedModels() {
            const cached = localStorage.getItem('cached_models');
            if (cached) this.modelList = JSON.parse(cached);
        }
    }
}).mount('#app');