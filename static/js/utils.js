// static/js/utils.js

/**
 * 图标库逻辑 (完整增强版)
 * 根据模型名称自动匹配对应的厂商图标
 */
const IconLibrary = {
    basePath: '/static/images/',

    // 1. 规则配置 (优先级从上到下)
    matchRules: [
        // --- 核心文本模型 ---
        { id: 'openai', keywords: ['gpt', 'o1-', 'openai', 'text-embedding', 'whisper', 'tts', 'dall-e'] },
        { id: 'claude', keywords: ['claude', 'anthropic'] },
        { id: 'google', keywords: ['gemini', 'palm', 'google', 'bard', 'imagen', 'veo'] },

        // --- 视频生成 (Video) ---
        { id: 'luma', keywords: ['luma', 'dream-machine'] },
        { id: 'runway', keywords: ['runway', 'gen-2', 'gen-3', 'act-one'] },
        { id: 'kling', keywords: ['kling', 'kuaishou', 'kolors'] }, // 快手可灵
        { id: 'hailuo', keywords: ['hailuo', 'minimax', 'video-01'] }, // 海螺/MiniMax
        { id: 'pika', keywords: ['pika'] },
        { id: 'vidu', keywords: ['vidu'] },
        { id: 'sora', keywords: ['sora'] },
        { id: 'wanx', keywords: ['wan2', 'wanx', 'wan-', 'alibaba'] }, // 阿里万相
        { id: 'cogvideo', keywords: ['cogvideo', 'zhipu', 'glm'] }, // 智谱
        { id: 'pixverse', keywords: ['pixverse'] },
        { id: 'higgsfield', keywords: ['higgsfield'] },

        // --- 绘图与设计 (Image/Design) ---
        { id: 'midjourney', keywords: ['midjourney', 'mj', 'niji'] },
        { id: 'stability', keywords: ['stable', 'sdxl', 'sd3', 'dreamstudio', 'core'] },
        { id: 'flux', keywords: ['flux', 'bfl'] }, // Black Forest Labs
        { id: 'ideogram', keywords: ['ideogram'] },
        { id: 'recraft', keywords: ['recraft'] },
        { id: 'jimeng', keywords: ['jimeng', 'doubao', 'volc'] }, // 即梦/豆包

        // --- 音乐与音频 (Audio) ---
        { id: 'suno', keywords: ['suno', 'chirp'] },
        { id: 'udio', keywords: ['udio'] },

        // --- 开源/其他 ---
        { id: 'deepseek', keywords: ['deepseek'] },
        { id: 'meta', keywords: ['llama', 'meta', 'facebook'] },
        { id: 'mistral', keywords: ['mistral', 'mixtral', 'codestral'] },
        { id: 'qwen', keywords: ['qwen', 'tongyi'] },
        { id: 'grok', keywords: ['grok', 'xai'] },
        { id: 'yi', keywords: ['yi-', '01.ai'] }
    ],

    specialExtensions: {
        'exampleid': '.png', // 如果有特殊后缀可以在这里定义
    },

    /**
     * 识别模型属于哪个厂商 ID
     */
    identifyProvider(modelName) {
        if (!modelName) return 'default';
        const lower = modelName.toLowerCase();

        // 规则优先匹配
        for (const rule of this.matchRules) {
            if (rule.keywords.some(keyword => lower.includes(keyword))) {
                return rule.id;
            }
        }

        // 智能兜底：尝试取 '/' 后面的部分或 '-' 前面的部分
        let processingName = lower;
        if (lower.includes('/')) {
            const parts = lower.split('/');
            processingName = parts[parts.length - 1];
        }

        const splitRegex = /[-_:]/;
        if (splitRegex.test(processingName)) {
            return processingName.split(splitRegex)[0];
        }

        return 'default';
    },

    getIcon(modelName) {
        const id = this.identifyProvider(modelName);
        const ext = this.specialExtensions[id] || '.svg';
        return `${this.basePath}${id}${ext}`;
    }
};

/**
 * IndexedDB 封装 (保持不变)
 */
const AppDB = {
    DB_NAME: "AIHubPro_DB",
    STORE_NAME: "sessions",

    async getDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: "id" });
                    store.createIndex("username", "username", { unique: false });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getAllByUsername(username) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, "readonly");
            const store = tx.objectStore(this.STORE_NAME);
            const index = store.index("username");
            const request = index.getAll(IDBKeyRange.only(username));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async saveSession(session) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, "readwrite");
            tx.objectStore(this.STORE_NAME).put(JSON.parse(JSON.stringify(session)));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async deleteSession(id) {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, "readwrite");
            tx.objectStore(this.STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};