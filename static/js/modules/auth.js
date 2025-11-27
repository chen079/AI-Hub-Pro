// auth.js
export const authMethods = {
    async checkLoginStatus() {
        try {
            const settings = await AppAPI.getSettings();
            if (settings) {
                this.isLoggedIn = true;
                this.applySettings(settings);
                if (this.authForm.username) await this.loadSessions();
                this.fetchUserStatus();
            }
        } catch (e) {
            console.log("Not logged in");
        }
    },

    async fetchUserStatus() {
        try {
            const res = await AppAPI.request('/api/user_status');
            this.paidMode = res.paid_mode;
            this.userPoints = res.points;
        } catch (e) { console.error(e); }
    },

    async handleAuth() {
        if (!this.authForm.username || !this.authForm.password) {
            this.authError = this.t('input_missing'); return;
        }
        try {
            const res = this.isRegistering
                ? await AppAPI.register(this.authForm.username, this.authForm.password)
                : await AppAPI.login(this.authForm.username, this.authForm.password);

            if (res.success) {
                if (this.isRegistering) {
                    this.isRegistering = false;
                    this.authForm.password = '';
                    AppUI.toast(this.t('reg_success_login'), 'success');
                } else {
                    this.isLoggedIn = true;
                    this.authError = '';
                    this.checkLoginStatus();
                }
            } else {
                this.authError = res.message;
            }
        } catch (e) {
            this.authError = this.t('network_err');
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
        this.isDarkMode = !!this.settings.dark_mode;
        this.updateHtmlClass();
    },

    async saveSettings() {
        this.settings.dark_mode = this.isDarkMode;
        await AppAPI.saveSettings(this.settings);
        this.showSettings = false;
    },

    async handleTopUp(amount) {
        const title = this.t('confirm_pay');
        const content = this.formatString(this.t('confirm_pay_text'), amount);
        const confirmed = await AppUI.confirm(title, content);
        if (!confirmed) return;
        try {
            const res = await AppAPI.request('/api/add_points', 'POST', { amount });
            if (res.success) {
                this.userPoints = res.new_balance;
                AppUI.toast(this.formatString(this.t('pay_success'), res.new_balance), 'success');
                this.showTopUpModal = false;
            }
        } catch (e) {
            AppUI.toast(this.t('pay_fail'), 'error');
        }
    },
};