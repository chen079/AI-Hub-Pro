// static/js/utils.js

/**
 * 图标库逻辑 (完整增强版)
 * 根据模型名称自动匹配对应的厂商图标
 */
const IconLibrary = {
    basePath: '/static/images/',

    // 1. 规则配置 (优先级从上到下)
    matchRules: window.SHARED_MATCH_RULES || [],

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