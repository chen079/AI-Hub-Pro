// static/js/api.js

const AppAPI = {
    // 基础请求封装
    async request(endpoint, method = 'GET', body = null) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (body) options.body = JSON.stringify(body);

        try {
            const res = await fetch(endpoint, options);
            return await res.json();
        } catch (e) {
            console.error(`API Error [${endpoint}]:`, e);
            throw e;
        }
    },

    async testConnection(endpoint, apiKey) {
        return this.request('/api/test_connection', 'POST', {
            api_endpoint: endpoint,
            api_key: apiKey
        });
    },

    // 登录
    async login(username, password) {
        return this.request('/api/login', 'POST', { username, password });
    },

    // 注册
    async register(username, password) {
        return this.request('/api/register', 'POST', { username, password });
    },

    // 获取设置
    async getSettings() {
        return this.request('/api/settings');
    },

    // 保存设置
    async saveSettings(settings) {
        return this.request('/api/settings', 'POST', settings);
    },

    // 获取模型列表
    async fetchModels() {
        return this.request('/api/fetch_models', 'POST', {});
    },

    // 上传头像
    async uploadAvatar(file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/upload_avatar', { method: 'POST', body: formData });
        return await res.json();
    },

    // [新增] 解析文档 (PDF/Docx/Txt)
    async parseDocument(fileObj) {
        const formData = new FormData();
        formData.append('file', fileObj);
        try {
            const res = await fetch('/api/parse_doc', { method: 'POST', body: formData });
            const data = await res.json();
            return data.success ? data.text : null;
        } catch (e) {
            console.error("Doc Parse Fail:", e);
            return null;
        }
    },

    // [核心] 流式对话请求 (修复了长数据截断 bug)
    async chatStream(params, callbacks) {
        const { messages } = params;
        const { onChunk, onDone, onError } = callbacks;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages })
            });

            if (response.status !== 200) {
                const err = await response.text();
                throw new Error(`Server Error: ${response.status} ${err}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            // === 修复点：增加缓冲区 ===
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // 1. 解码当前块并追加到缓冲区
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // 2. 按换行符分割 (流式数据以 \n 分隔)
                const lines = buffer.split('\n');

                // 3. 拿出最后一段 (因为最后一段可能还没传完，是不完整的)
                // 将其保留在 buffer 中，等待下一次拼接
                buffer = lines.pop();

                // 4. 处理前面完整的行
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.substring(6).trim();
                        if (!jsonStr || jsonStr === '[DONE]') continue;

                        try {
                            // 尝试解析 JSON
                            if (jsonStr.startsWith('{')) {
                                const json = JSON.parse(jsonStr);
                                if (json.error) {
                                    onError(json.error);
                                    return;
                                }
                                if (json.choices && json.choices[0].delta.content) {
                                    onChunk(json.choices[0].delta.content);
                                }
                            } else {
                                // 简单文本流
                                onChunk(jsonStr);
                            }
                        } catch (e) {
                            // 只有在确定是一整行数据解析失败时，才当作文本输出
                            // 但因为我们已经处理了 buffer，这里出错通常是真的非 JSON 数据
                            // onChunk(jsonStr); // 建议注释掉这行，防止报错信息混入图片数据
                            console.warn("JSON Parse Error (Ignore):", e);
                        }
                    }
                }
            }
            onDone();

        } catch (e) {
            onError(e.message);
        }
    }
};