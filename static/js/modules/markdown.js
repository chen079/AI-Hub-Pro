// markdown.js
export const markdownMethods = {
    // 渲染 Markdown 内容
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
};

// 全局挂载复制函数 (因为 HTML 是字符串生成的，onclick 需要访问全局 window)
window.copyCodeBlock = async (btn) => {
    const wrapper = btn.closest('.code-block-wrapper');
    const codeBlock = wrapper.querySelector('code');
    if (!codeBlock) return;
    const text = codeBlock.innerText;
    const success = await AppClipboard.copy(text); // 假设 AppClipboard 是全局的
    if (success) {
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.classList.add('text-green-500');
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('text-green-500');
        }, 2000);
    } else {
        const lang = localStorage.getItem('app_lang') || 'zh';
        AppUI.toast(window.MESSAGES?.[lang]?.['copy_fail_alert'] || 'Copy failed', 'error');
    }
};