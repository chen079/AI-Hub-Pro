// static/js/ui.js

const AppUI = {
    /**
     * 显示轻提示 (Toast)
     * @param {string} message 消息内容
     * @param {string} type 类型: 'success', 'error', 'info', 'warning'
     * @param {number} duration 持续时间(ms), 默认 3000
     */
    toast(message, type = 'info', duration = 3000) {
        // 1. 图标与颜色映射 (增加了 borderColor 字段)
        const config = {
            success: { icon: 'fa-check-circle', color: 'text-green-500', borderColor: 'border-green-500' },
            error:   { icon: 'fa-times-circle', color: 'text-red-500',   borderColor: 'border-red-500' },
            warning: { icon: 'fa-exclamation-circle', color: 'text-yellow-500', borderColor: 'border-yellow-500' },
            info:    { icon: 'fa-info-circle',  color: 'text-blue-500',   borderColor: 'border-blue-500' }
        };
        const style = config[type] || config.info;

        // 2. 创建容器 (保持不变)
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'fixed top-6 left-1/2 transform -translate-x-1/2 z-[9999] flex flex-col gap-3 pointer-events-none';
            document.body.appendChild(container);
        }

        // 3. 创建 Toast 元素
        const el = document.createElement('div');
        
        // 【修改点】
        // 1. 添加 border-l-4 (左边框宽度)
        // 2. 添加 style.borderColor (左边框颜色，不再是黑/白)
        // 3. 移除原来的 el.style.borderLeft 行内样式
        el.className = `
            pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg 
            bg-white dark:bg-darkcard 
            border-t border-r border-b border-gray-100 dark:border-darkborder 
            border-l-4 ${style.borderColor}
            transform transition-all duration-300 ease-out translate-y-[-20px] opacity-0
            min-w-[300px] max-w-[90vw]
        `;

        el.innerHTML = `
            <i class="fas ${style.icon} ${style.color} text-lg"></i>
            <span class="text-sm font-medium text-gray-700 dark:text-gray-200 flex-1 break-words">${message}</span>
        `;

        // 4. 添加到页面
        container.appendChild(el);

        // 5. 动画进入
        requestAnimationFrame(() => {
            el.classList.remove('translate-y-[-20px]', 'opacity-0');
        });

        // 6. 自动移除
        setTimeout(() => {
            el.classList.add('opacity-0', '-translate-y-4');
            setTimeout(() => el.remove(), 300);
        }, duration);
    },

    /**
     * 显示警告弹窗 (Alert) - 替代 window.alert
     * @param {string} title 标题
     * @param {string} content 内容
     * @returns Promise
     */
    alert(title, content) {
        return this._createModal(title, content, false);
    },

    /**
     * 显示确认弹窗 (Confirm) - 替代 window.confirm
     * @param {string} title 标题
     * @param {string} content 内容
     * @returns Promise<boolean> (true=确认, false=取消)
     */
    confirm(title, content) {
        return this._createModal(title, content, true);
    },

    // 内部方法：构建模态框
    _createModal(title, content, isConfirm) {
        return new Promise((resolve) => {
            // 1. 创建遮罩层
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 z-[1000] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center opacity-0 transition-opacity duration-200';
            
            // 2. 创建弹窗主体
            const modal = document.createElement('div');
            modal.className = `
                bg-white dark:bg-darkcard w-[90%] max-w-sm rounded-xl shadow-2xl 
                transform scale-95 opacity-0 transition-all duration-200
                border border-gray-100 dark:border-darkborder overflow-hidden
            `;

            // 3. 内容 HTML
            modal.innerHTML = `
                <div class="p-6 text-center">
                    <div class="mb-4 text-3xl">
                        <i class="fas ${isConfirm ? 'fa-question-circle text-blue-500' : 'fa-exclamation-circle text-yellow-500'}"></i>
                    </div>
                    <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-2">${title}</h3>
                    <p class="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">${content}</p>
                </div>
                <div class="flex border-t border-gray-100 dark:border-darkborder">
                    ${isConfirm ? `
                    <button id="app-modal-cancel" class="flex-1 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-darkinput transition border-r border-gray-100 dark:border-darkborder">
                        取消
                    </button>
                    ` : ''}
                    <button id="app-modal-confirm" class="flex-1 py-3 text-sm font-medium ${isConfirm ? 'text-blue-600 dark:text-blue-400' : 'text-blue-600 dark:text-blue-400'} hover:bg-gray-50 dark:hover:bg-darkinput transition">
                        ${isConfirm ? '确定' : '知道了'}
                    </button>
                </div>
            `;

            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // 4. 动画显示
            requestAnimationFrame(() => {
                overlay.classList.remove('opacity-0');
                modal.classList.remove('scale-95', 'opacity-0');
                modal.classList.add('scale-100');
            });

            // 5. 事件处理
            const close = (result) => {
                overlay.classList.add('opacity-0');
                modal.classList.add('scale-95', 'opacity-0');
                setTimeout(() => {
                    overlay.remove();
                    resolve(result);
                }, 200);
            };

            const confirmBtn = modal.querySelector('#app-modal-confirm');
            confirmBtn.onclick = () => close(true);
            confirmBtn.focus(); // 自动聚焦确认按钮

            if (isConfirm) {
                const cancelBtn = modal.querySelector('#app-modal-cancel');
                cancelBtn.onclick = () => close(false);
                // 点击遮罩层也可以关闭
                overlay.onclick = (e) => {
                    if (e.target === overlay) close(false);
                };
            } else {
                 overlay.onclick = (e) => {
                    if (e.target === overlay) close(true);
                };
            }
            
            // 支持回车和ESC
            const keyHandler = (e) => {
                if (!document.body.contains(overlay)) {
                    document.removeEventListener('keydown', keyHandler);
                    return;
                }
                if (e.key === 'Enter') close(true);
                if (e.key === 'Escape') close(false);
            };
            document.addEventListener('keydown', keyHandler);
        });
    }
};