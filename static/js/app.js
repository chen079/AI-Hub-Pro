// static/js/app.js

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

            // --- 数据 ---
            authForm: { username: '', password: '' },
            authError: '',

            settings: {
                api_endpoint: 'https://api.openai.com/v1',
                api_key: '',
                model: 'gpt-3.5-turbo',
                system_prompt: 'You are a helpful assistant.',
                user_avatar: '',
                dark_mode: false
            },

            useCustomModel: false, // [新增]
            modelSearchQuery: '',  // [新增] 搜索关键词
            modelList: ['gpt-4o', 'gpt-3.5-turbo', 'claude-3-5-sonnet'],
            previousStandardModel: null, // [新增] 用于深度思考切换回退

            // --- 会话数据 ---
            sessions: [],
            currentSessionId: null,
            messages: [],

            // --- 输入区域 ---
            inputMessage: '',
            attachedFiles: [],
            // 【新增】提示词库数组
            promptLibrary: [
                { icon: '⚛️', title: '量子纠缠', content: '请用通俗易懂的语言解释量子纠缠，并举一个生活中的例子说明，最好能用“双胞胎”来比喻。' },
                { icon: '🐍', title: 'Python 爬虫', content: '写一个 Python 爬虫脚本，使用 requests 和 BeautifulSoup 库，抓取一个网页的标题和所有链接，并处理异常情况。' },
                { icon: '📝', title: '周报生成', content: '我本周完成了：1. 修复登录 API 的 Bug；2. 优化数据库查询速度；3. 协助测试团队回归测试。请帮我扩写成一份正式的周报。' },
                { icon: '🎨', title: 'SVG 图标', content: '请生成一个扁平化风格的“火箭发射”图标的 SVG 代码，颜色使用橙色和深蓝色。' },
                { icon: '⚖️', title: '法律咨询', content: '如果你是一名资深律师，请分析一下：邻居装修噪音在周末早上8点开始施工，是否违反了中国相关法律法规？我该如何维权？' },
                { icon: '🍳', title: '食谱推荐', content: '我冰箱里有鸡蛋、西红柿、土豆和牛肉。请推荐两道家常菜，并给出详细的做法步骤。' },
                { icon: '📊', title: 'SQL 优化', content: '我有一个包含 500 万条数据的订单表，查询速度很慢。请给出几个常见的 SQL 查询优化建议和索引策略。' },
                { icon: '🧠', title: '头脑风暴', content: '请为一款针对大学生的“时间管理 APP”想 5 个富有创意的名字，并简述每个名字的设计理念。' }
            ],
            randomPrompts: [], // 【新增】用于当前显示的随机数据
        }
    },

    mounted() {
        // 移动端自动收起侧边栏
        if (window.innerWidth < 768) this.showSidebar = false;

        // 监听粘贴事件 (支持粘贴截图)
        window.addEventListener('paste', this.handlePaste);

        // 初始化
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
                }
            } catch (e) {
                console.log("Not logged in");
            }
        },

        async handleAuth() {
            if (!this.authForm.username || !this.authForm.password) {
                this.authError = "请输入完整信息"; return;
            }
            try {
                const res = this.isRegistering
                    ? await AppAPI.register(this.authForm.username, this.authForm.password)
                    : await AppAPI.login(this.authForm.username, this.authForm.password);

                if (res.success) {
                    if (this.isRegistering) {
                        this.isRegistering = false;
                        this.authForm.password = '';
                        alert('注册成功，请登录');
                    } else {
                        this.isLoggedIn = true;
                        this.authError = '';
                        this.checkLoginStatus();
                    }
                } else {
                    this.authError = res.message;
                }
            } catch (e) {
                this.authError = "网络请求失败";
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

        // [新增] 处理测试连接
        async handleTestConnection() {
            if (!this.settings.api_endpoint) {
                alert("请先输入 API Endpoint");
                return;
            }

            // 允许 Key 为空（如果是为了测试已保存的 Key）
            // 但如果两个都为空肯定不行
            if (!this.settings.api_endpoint) {
                alert("请输入配置信息"); return;
            }

            this.isTestingConnection = true;
            try {
                // 调用 API.js 中的方法
                const res = await AppAPI.testConnection(
                    this.settings.api_endpoint,
                    this.settings.api_key // 传入当前输入框的值
                );

                if (res.success) {
                    alert("✅ " + res.message);
                    // 如果测试成功，自动刷新一下模型列表，方便用户选择
                    this.fetchModels();
                } else {
                    alert("❌ " + res.message);
                }
            } catch (e) {
                alert("❌ 请求发送失败，请检查网络连接");
                console.error(e);
            } finally {
                this.isTestingConnection = false;
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

        startNewChat() {
            this.currentSessionId = null;
            this.messages = [];
            this.inputMessage = '';
            this.attachedFiles = [];
            if (window.innerWidth < 768) this.showSidebar = false;
        },

        async deleteSession(id) {
            if (!confirm('确定删除?')) return;
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
            const current = this.settings.model;
            const keywords = ['reason', 'think', 'o1-', 'r1'];

            if (this.isDeepThinkingEnabled) {
                // 如果当前是思考模型，切换回标准模型
                if (this.previousStandardModel && this.modelList.includes(this.previousStandardModel)) {
                    this.settings.model = this.previousStandardModel;
                } else {
                    const fallback = this.modelList.find(m => !keywords.some(k => m.toLowerCase().includes(k)));
                    this.settings.model = fallback || 'gpt-3.5-turbo';
                }
            } else {
                // 如果当前是标准模型，切换去思考模型
                this.previousStandardModel = current;
                const thinkingModel = this.modelList.find(m =>
                    keywords.some(k => m.toLowerCase().includes(k))
                );

                if (thinkingModel) {
                    this.settings.model = thinkingModel;
                } else {
                    alert("列表里没找到思考模型 (如 reasoner, o1)。请先在设置中刷新。");
                }
            }
            this.saveSettings();
        },

        // ===========================
        // 3. 聊天核心逻辑
        // ===========================
        async sendMessage() {
            // 校验
            if ((!this.inputMessage.trim() && this.attachedFiles.length === 0) || this.isThinking) return;

            const textContent = this.inputMessage;
            const currentFiles = [...this.attachedFiles]; // 快照

            // 清空输入
            this.inputMessage = '';
            this.attachedFiles = [];

            // 1. 获取或创建会话
            let session;
            if (!this.currentSessionId) {
                session = await this.createSessionObject(textContent || '媒体消息');
            } else {
                session = this.sessions.find(s => s.id === this.currentSessionId);
            }

            // 2. 推送用户消息上屏
            const userMsg = {
                role: 'user',
                content: textContent,
                files: currentFiles, // 保留原始文件引用用于展示
                model: this.settings.model
            };
            this.messages.push(userMsg);
            this.smartScrollToBottom(true);

            // 3. [文档解析步骤]
            // 如果上传了文档，先请求后端解析，将文本附加到 User Context 中
            let finalPrompt = textContent;
            const docFiles = currentFiles.filter(f => f.type === 'doc');

            if (docFiles.length > 0) {
                // 临时显示正在解析
                this.messages.push({ role: 'assistant', content: 'Processing documents...', model: 'System' });
                this.smartScrollToBottom();

                for (let fileObj of docFiles) {
                    const extractedText = await AppAPI.parseDocument(fileObj.raw);
                    if (extractedText) {
                        finalPrompt += `\n\n--- Document: ${fileObj.name} ---\n${extractedText}\n----------------\n`;
                    }
                }
                // 移除临时消息
                this.messages.pop();
            }

            // 4. 构建 API 消息格式 (OpenAI 兼容)
            const apiMessages = this.messages.map(msg => {
                // 处理当前发送的消息
                if (msg === userMsg) {
                    const contentParts = [];
                    // 添加文本 (包含了解析后的文档内容)
                    if (finalPrompt) contentParts.push({ type: "text", text: finalPrompt });

                    // 添加图片 (Vision API)
                    msg.files.forEach(f => {
                        if (f.type === 'image') {
                            contentParts.push({ type: "image_url", image_url: { url: f.content } });
                        }
                    });

                    if (contentParts.length === 1 && contentParts[0].type === 'text') {
                        return { role: "user", content: finalPrompt };
                    }
                    return { role: "user", content: contentParts };
                }

                // 处理历史消息 (简化处理，不回传过大的历史图片/文档以省 Token)
                // 如果需要回传历史图片，需在此处展开 msg.files
                return { role: msg.role, content: msg.content };
            });

            // 5. 准备接收回复
            this.isThinking = true;
            let aiMsgIndex = -1;

            await AppAPI.chatStream({ messages: apiMessages }, {
                onChunk: (text) => {
                    this.isThinking = false;
                    this.isStreaming = true;

                    // 如果是第一帧，创建 AI 消息气泡
                    if (aiMsgIndex === -1) {
                        this.messages.push({ role: 'assistant', content: '', model: this.settings.model });
                        aiMsgIndex = this.messages.length - 1;
                    }

                    this.messages[aiMsgIndex].content += text;
                    // 智能滚动：只有用户在底部时才滚
                    if (this.isUserAtBottom) this.smartScrollToBottom();
                },
                onDone: async () => {
                    this.isThinking = false;
                    this.isStreaming = false;
                    if (session) {
                        session.messages = this.messages;
                        await AppDB.saveSession(session);
                    }
                    this.smartScrollToBottom();
                },
                onError: (err) => {
                    this.isThinking = false;
                    this.messages.push({ role: 'assistant', content: `Error: ${err}`, model: 'System' });
                    this.smartScrollToBottom();
                }
            });
        },

        // ===========================
        // 4. 辅助功能 (渲染、滚动、文件)
        // ===========================
        renderContent(text) {
            if (!text) return '';

            let processed = text;

            // 1. 思维链 (DeepSeek/Claude Thinking)
            processed = processed.replace(
                /<think>([\s\S]*?)<\/think>/g,
                '<details class="think-block" open><summary>深度思考过程</summary><div class="content">$1</div></details>'
            );
            // 处理未闭合的 thinking
            if (processed.includes('<think>') && !processed.includes('</think>')) {
                processed = processed.replace(
                    /<think>([\s\S]*)/g,
                    '<details class="think-block" open><summary>思考中...</summary><div class="content">$1</div></details>'
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
            const linkRenderer = renderer.link;
            renderer.link = (href, title, text) => {
                const html = linkRenderer.call(renderer, href, title, text);
                return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
            };

            // Markdown 解析
            let html = marked.parse(processed, { renderer: renderer });

            // 代码高亮
            this.$nextTick(() => {
                if (typeof hljs !== 'undefined') {
                    document.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));
                }
            });
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
            for (let file of files) {
                // 1. 简单的文件大小限制 (例如 20MB)，防止浏览器崩溃
                if (file.size > 20 * 1024 * 1024) {
                    alert(`文件 ${file.name} 太大，请上传 20MB 以内的文件`);
                    continue;
                }

                // 2. 识别类型
                let type = 'doc';
                if (file.type.startsWith('image/')) type = 'image';
                else if (file.type.startsWith('audio/')) type = 'audio'; // 新增
                else if (file.type.startsWith('video/')) type = 'video'; // 新增

                // 3. 多媒体文件 (图片/音频/视频) 都读取为 Base64 以便预览
                if (['image', 'audio', 'video'].includes(type)) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        this.attachedFiles.push({
                            name: file.name,
                            type: type,
                            content: e.target.result, // Base64 数据
                            raw: file
                        });
                    };
                    reader.readAsDataURL(file);
                } else {
                    // 普通文档 (PDF/Docx/Txt) 不需要立即读取内容
                    this.attachedFiles.push({
                        name: file.name,
                        type: 'doc',
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