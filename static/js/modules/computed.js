// computed.js
export const computedProps = {
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
            return acc + this.estimateTokens(msg.content);
        }, 0);
    },
    isDeepThinkingEnabled() {
        const m = this.settings.model.toLowerCase();
        const keywords = ['reason', 'think', 'o1-', 'r1'];
        return keywords.some(k => m.includes(k));
    },
    groupedModels() {
        const groups = {};
        if (!this.modelList || this.modelList.length === 0) return groups;
        const query = this.modelSearchQuery.toLowerCase();
        const filteredList = this.modelList.filter(m => m.toLowerCase().includes(query));

        filteredList.forEach(model => {
            let providerId = IconLibrary.identifyProvider(model);
            let groupTitle = providerId.charAt(0).toUpperCase() + providerId.slice(1);
            if (!groups[groupTitle]) groups[groupTitle] = [];
            groups[groupTitle].push(model);
        });

        return Object.keys(groups).sort().reduce((acc, key) => {
            acc[key] = groups[key];
            return acc;
        }, {});
    }
};