// chat.js
export const chatMethods = {
    // === 会话管理 ===
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
        this.isThinking = false;
        this.isStreaming = false;
        if (window.innerWidth < 768) this.showSidebar = false;
    },

    async deleteSession(id) {
        const isConfirmed = await AppUI.confirm(this.t('del_session_title'), this.t('del_session_desc'));
        if (!isConfirmed) return;
        await AppDB.deleteSession(id);
        AppUI.toast('删除成功', 'success');
        this.sessions = this.sessions.filter(s => s.id !== id);
        if (this.currentSessionId === id) this.startNewChat();
    },

    async renameSession(id) {
        const session = this.sessions.find(s => s.id === id);
        if (!session) return;
        const newTitle = await AppUI.input(this.t('rename_title'), session.title, this.t('rename_ph'));
        if (newTitle !== null) {
            session.title = newTitle;
            await AppDB.saveSession(session);
            AppUI.toast(this.t('rename_success'), 'success');
        }
    },

    // === 消息操作 (复制, 删除, 编辑, 重试) ===
    async copyMessage(text) {
        const success = await AppClipboard.copy(text);
        if (success) AppUI.toast(this.t('copy_success'), 'success');
        else AppUI.toast(this.t('copy_fail_browser'), 'error');
    },

    async deleteMessage(index) {
        const confirmed = await AppUI.confirm(this.t('delete_confirm_title'), this.t('del_msg_confirm'));
        if (!confirmed) return;
        this.messages.splice(index, 1);
        await this.saveCurrentSessionData();
    },

    async editMessage(index) {
        const msg = this.messages[index];
        const newContent = await AppUI.input(this.t('edit_msg_title'), msg.content, this.t('edit_msg_ph'));
        if (newContent !== null) {
            msg.content = newContent;
            await this.saveCurrentSessionData();
            AppUI.toast(this.t('msg_edited'), 'success');
        }
    },

    async regenerateResponse(aiIndex) {
        if (this.isThinking || this.isStreaming) return;
        let targetIndex = aiIndex !== undefined ? aiIndex : this.messages.length - 1;
        if (targetIndex < 0 || this.messages[targetIndex].role === 'user') return;
        this.messages.splice(targetIndex, 1);
        await this.streamResponse();
    },

    async saveCurrentSessionData() {
        if (this.currentSessionId) {
            const session = this.sessions.find(s => s.id === this.currentSessionId);
            if (session) {
                session.messages = this.messages;
                await AppDB.saveSession(session);
            }
        }
    },

    // === 核心发送逻辑 (sendMessage, streamResponse) ===
    // (由于篇幅限制，这里直接引用你原有的 sendMessage 和 streamResponse 代码，不需要改动逻辑)
    // 记得在 sendMessage 里调用 parseDocument 时，AppAPI 是全局的，没问题。
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
    
    // 辅助估算
    estimateTokens(text) {
        if (!text) return 0;
        const cjkMatch = text.match(/[\u4e00-\u9fa5]/g);
        const cjkCount = cjkMatch ? cjkMatch.length : 0;
        const otherCount = text.length - cjkCount;
        return Math.ceil(cjkCount * 1.6 + otherCount * 0.25);
    },
};