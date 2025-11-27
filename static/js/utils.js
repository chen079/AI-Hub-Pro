// static/js/utils.js

/**
 * 图标库逻辑 (完整增强版)
 * 根据模型名称自动匹配对应的厂商图标
 */
const FALLBACK_RULES = [
    { id: 'openai', keywords: ['gpt', 'o1-', 'openai', 'text-embedding', 'whisper', 'tts', 'dall-e'] },
    { id: 'claude', keywords: ['claude', 'anthropic'] },
    { id: 'google', keywords: ['gemini', 'palm', 'google', 'bard', 'imagen', 'veo'] },
    { "id": "deepseek", "keywords": ["deepseek"] },
    { "id": "midjourney", "keywords": ["midjourney", "mj", "niji"] },
    { "id": "stability", "keywords": ["stable", "sdxl", "sd3", "dreamstudio", "core"] },
    { "id": "suno", "keywords": ["suno", "chirp"] },
    { "id": "luma", "keywords": ["luma", "dream-machine"] },
    { "id": "runway", "keywords": ["runway", "gen-2", "gen-3", "act-one"] },
    { "id": "kling", "keywords": ["kling", "kuaishou", "kolors"] },
    { "id": "hailuo", "keywords": ["hailuo", "minimax", "video-01"] },
    { "id": "pika", "keywords": ["pika"] },
    { "id": "vidu", "keywords": ["vidu"] },
    { "id": "sora", "keywords": ["sora"] },
    { "id": "wanx", "keywords": ["wan2", "wanx", "wan-", "alibaba"] },
    { "id": "cogvideo", "keywords": ["cogvideo", "zhipu", "glm"] },
    { "id": "pixverse", "keywords": ["pixverse"] },
    { "id": "higgsfield", "keywords": ["higgsfield"] },
    { "id": "ideogram", "keywords": ["ideogram"] },
    { "id": "recraft", "keywords": ["recraft"] },
    { "id": "jimeng", "keywords": ["jimeng", "doubao", "volc"] },
    { "id": "udio", "keywords": ["udio"] },
    { "id": "meta", "keywords": ["llama", "meta", "facebook"] },
    { "id": "mistral", "keywords": ["mistral", "mixtral", "codestral"] },
    { "id": "qwen", "keywords": ["qwen", "tongyi"] },
    { "id": "grok", "keywords": ["grok", "xai"] },
    { "id": "yi", "keywords": ["yi-", "01.ai"] },
    { "id": "kimi", "keywords": ["kimi"] }
];

/**
 * 图标库逻辑 (完整增强版)
 */
const IconLibrary = {
    basePath: '/static/images/',

    // 【核心修复】
    // 优先使用后端传来的规则；如果后端没传(空或undefined)，则使用本地兜底规则
    // 这样能保证 GPT 永远被识别为 openai
    matchRules: (window.SHARED_MATCH_RULES && window.SHARED_MATCH_RULES.length > 0)
        ? window.SHARED_MATCH_RULES
        : FALLBACK_RULES,

    specialExtensions: {
        'exampleid': '.png',
    },

    /**
     * 识别模型属于哪个厂商 ID
     */
    identifyProvider(modelName) {
        if (!modelName) return 'default';
        const lower = modelName.toLowerCase();

        // 1. 规则优先匹配 (Backend Rules + Fallback)
        for (const rule of this.matchRules) {
            if (rule.keywords.some(keyword => lower.includes(keyword))) {
                return rule.id;
            }
        }

        // 2. [重要修复] 移除智能兜底逻辑，防止出现 'bge', 'text' 这种没有对应 svg 的 ID
        // 如果不在规则列表里，一律视为 default
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

const AppClipboard = {
    /**
     * 通用复制函数 (兼容 HTTP 和 HTTPS)
     * @param {string} text 要复制的文本
     * @returns {Promise<boolean>} 是否成功
     */
    async copy(text) {
        if (!text) return false;

        // 内部降级函数：使用 textarea hack
        const fallbackCopy = (textToCopy) => {
            try {
                const textArea = document.createElement("textarea");
                textArea.value = textToCopy;

                // 隐藏且防止滚动
                textArea.style.top = "0";
                textArea.style.left = "0";
                textArea.style.position = "fixed";
                textArea.style.opacity = "0";

                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                return successful;
            } catch (err) {
                console.error('Fallback Copy Error:', err);
                return false;
            }
        };

        // 优先使用现代 API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (err) {
                console.warn('Clipboard API error, switching to fallback:', err);
                return fallbackCopy(text);
            }
        } else {
            // 降级使用旧版 API
            return fallbackCopy(text);
        }
    }
};