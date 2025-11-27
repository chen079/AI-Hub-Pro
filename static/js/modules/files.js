// files.js
export const fileMethods = {
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
    
    getModelAvatar(modelName) {
        return IconLibrary.getIcon(modelName);
    },

    processFiles(files) {
        if (!files || files.length === 0) return;
        for (let file of files) {
            if (file.size > 20 * 1024 * 1024) {
                AppUI.toast(`文件 ${file.name} 太大，请上传 20MB 以内的文件`, 'error');
                continue;
            }
            let type = 'doc';
            const ext = file.name.split('.').pop().toLowerCase();
            if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
                type = 'image';
            } else if (file.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) {
                type = 'audio';
            } else if (file.type.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
                type = 'video';
            }

            if (['image', 'audio', 'video'].includes(type)) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    this.attachedFiles.push({ name: file.name, type: type, content: e.target.result, raw: file });
                };
                reader.readAsDataURL(file);
            } else {
                this.attachedFiles.push({ name: file.name, type: 'doc', content: null, raw: file });
            }
        }
    },

    removeFile(index) {
        this.attachedFiles.splice(index, 1);
    },

    triggerAvatarUpload() { document.getElementById('avatar-upload-input').click(); },
    
    async handleAvatarSelect(e) {
        if (e.target.files[0]) {
            const res = await AppAPI.uploadAvatar(e.target.files[0]);
            if (res.success) this.settings.user_avatar = res.avatar;
        }
    },
};