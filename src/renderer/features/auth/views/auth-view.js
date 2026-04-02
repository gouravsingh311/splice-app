/* Auth View — login, register, forgot/reset */
(function (global, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (global && typeof global === 'object') { global.viewAuth = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    function getWrappers() {
        if (typeof globalThis !== 'undefined' && globalThis.flowbiteWrappers) {
            return globalThis.flowbiteWrappers;
        }
        if (typeof window !== 'undefined' && window.flowbiteWrappers) {
            return window.flowbiteWrappers;
        }
        return null;
    }

    function wrapControl(name, options, fallbackClass) {
        var wrappers = getWrappers();
        if (wrappers && typeof wrappers[name] === 'function') {
            return wrappers[name](options || {});
        }
        return { className: fallbackClass || '', attrString: '' };
    }

    function getTemplate() {
        var tabsList = wrapControl('tabsList', {
            control: 'auth-tabs',
            className: 'inline-flex w-full items-center gap-2 rounded-brand-pill border border-brand-border bg-brand-surface-alt p-1 mb-8',
        });
        var loginTab = wrapControl('tabTrigger', {
            controls: 'login-form',
            selected: false,
            control: 'auth-tab-login',
            className: 'auth-tab active flex-1 justify-center rounded-brand-pill text-sm font-medium',
        });
        var registerTab = wrapControl('tabTrigger', {
            controls: 'register-form',
            selected: false,
            control: 'auth-tab-register',
            className: 'auth-tab flex-1 justify-center rounded-brand-pill text-sm font-medium',
        });
        var forgotTab = wrapControl('tabTrigger', {
            controls: 'forgot-form',
            selected: false,
            control: 'auth-tab-forgot',
            className: 'auth-tab flex-1 justify-center rounded-brand-pill text-sm font-medium',
        });
        var loginEmail = wrapControl('input', { control: 'auth-login-email', type: 'email' });
        var loginPassword = wrapControl('input', { control: 'auth-login-password', type: 'password' });
        var loginSubmit = wrapControl('button', {
            control: 'auth-login-submit',
            type: 'submit',
            tone: 'primary',
            className: 'w-full',
        });
        var loginForgot = wrapControl('button', {
            control: 'auth-login-forgot',
            type: 'button',
            tone: 'ghost',
            size: 'sm',
            className: 'px-0 py-0 text-xs text-brand-accent underline underline-offset-4',
        });
        var loginShowPassword = wrapControl('button', {
            control: 'auth-login-toggle-password',
            type: 'button',
            tone: 'ghost',
            size: 'sm',
            className: 'absolute right-2 top-1/2 z-20 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-brand-border/70 bg-brand-surface text-brand-text-strong hover:bg-brand-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
        });

        var registerEmail = wrapControl('input', { control: 'auth-register-email', type: 'email' });
        var registerPassword = wrapControl('input', { control: 'auth-register-password', type: 'password' });
        var registerConfirm = wrapControl('input', { control: 'auth-register-confirm', type: 'password' });
        var registerRoleTrigger = wrapControl('button', {
            control: 'auth-register-role-trigger',
            type: 'button',
            tone: 'secondary',
            className: 'w-full justify-between',
        });
        var registerRoleCreator = wrapControl('button', {
            control: 'auth-register-role-option',
            type: 'button',
            tone: 'ghost',
            size: 'sm',
            className: 'auth-role-option active w-full justify-between bg-brand-accent text-brand-text-strong',
            uiId: 'role-creator',
        });
        var registerRoleReviewer = wrapControl('button', {
            control: 'auth-register-role-option',
            type: 'button',
            tone: 'ghost',
            size: 'sm',
            className: 'auth-role-option w-full justify-between',
            uiId: 'role-reviewer',
        });
        var registerRoleAdmin = wrapControl('button', {
            control: 'auth-register-role-option',
            type: 'button',
            tone: 'ghost',
            size: 'sm',
            className: 'auth-role-option w-full justify-between',
            uiId: 'role-admin',
        });
        var registerSendOtp = wrapControl('button', {
            control: 'auth-register-send-otp',
            type: 'button',
            tone: 'secondary',
            size: 'sm',
        });
        var registerVerifyOtp = wrapControl('button', {
            control: 'auth-register-verify-otp',
            type: 'button',
            tone: 'secondary',
            size: 'sm',
        });
        var registerOtp = wrapControl('input', { control: 'auth-register-otp', type: 'text' });
        var registerSubmit = wrapControl('button', {
            control: 'auth-register-submit',
            type: 'submit',
            tone: 'primary',
            className: 'w-full',
        });

        var forgotEmail = wrapControl('input', { control: 'auth-forgot-email', type: 'email' });
        var resetPassword = wrapControl('input', { control: 'auth-reset-password', type: 'password' });
        var resetConfirm = wrapControl('input', { control: 'auth-reset-confirm', type: 'password' });
        var forgotSendOtp = wrapControl('button', {
            control: 'auth-forgot-send-otp',
            type: 'button',
            tone: 'secondary',
            size: 'sm',
        });
        var forgotVerifyOtp = wrapControl('button', {
            control: 'auth-forgot-verify-otp',
            type: 'button',
            tone: 'secondary',
            size: 'sm',
        });
        var forgotOtp = wrapControl('input', { control: 'auth-forgot-otp', type: 'text' });
        var forgotSubmit = wrapControl('button', {
            control: 'auth-forgot-submit',
            type: 'submit',
            tone: 'primary',
            className: 'w-full',
        });
        return `
<section class="fe-view" data-view="auth" id="view-auth">
  <div class="fe-auth-wrap">
    <div class="fe-auth-glow-a"></div>
    <div class="fe-auth-glow-b"></div>
    <main class="fe-auth-main">
      <div class="fe-auth-card">
        <div class="text-center mb-8">
          <p class="font-ui text-xs uppercase tracking-[0.2em] text-brand-accent font-semibold">FileEaters Enterprise</p>
          <h1 class="mt-2 font-display text-4xl text-brand-text-strong">Auth &amp; Access</h1>
          <p class="mt-2 text-sm text-brand-text">Sign in, register, or reset your password.</p>
        </div>
        <div class="${tabsList.className}" ${tabsList.attrString} aria-label="Auth forms">
          <button id="tab-login" class="${loginTab.className}" ${loginTab.attrString} data-auth-tab="login">Login</button>
          <button id="tab-register" class="${registerTab.className}" ${registerTab.attrString} data-auth-tab="register">Register</button>
          <button id="tab-forgot" class="${forgotTab.className}" ${forgotTab.attrString} data-auth-tab="forgot">Forgot / Reset</button>
        </div>

        <form id="login-form" data-auth-view="login" class="space-y-4">
          <div>
            <label class="fe-label" for="login-email">Work Email</label>
            <input id="login-email" class="${loginEmail.className}" ${loginEmail.attrString} name="email" autocomplete="email" placeholder="name@company.com" />
          </div>
          <div>
            <div class="flex justify-between items-center mb-1">
              <label class="fe-label-inline" for="login-password">Password</label>
              <button class="${loginForgot.className}" ${loginForgot.attrString} data-auth-tab="forgot">Forgot password?</button>
            </div>
            <div class="relative">
              <input id="login-password" class="${loginPassword.className} pr-12" ${loginPassword.attrString} name="password" autocomplete="current-password" placeholder="Minimum 12 characters" />
              <button id="login-toggle-password" class="${loginShowPassword.className}" ${loginShowPassword.attrString} type="button" aria-controls="login-password" aria-pressed="false" aria-label="Show password">
                <span id="login-toggle-password-icon" aria-hidden="true" class="inline-flex h-4 w-4 items-center justify-center"></span>
              </button>
            </div>
          </div>
          <button class="${loginSubmit.className}" ${loginSubmit.attrString}>Sign In</button>
          <p id="login-feedback" class="auth-feedback hidden" aria-live="polite"></p>
        </form>

        <form id="register-form" data-auth-view="register" class="hidden space-y-4">
          <div>
            <label class="fe-label" for="register-email">Email</label>
            <input id="register-email" class="${registerEmail.className}" ${registerEmail.attrString} name="email" autocomplete="email" placeholder="name@company.com" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="fe-label" for="register-password">Password</label>
              <input id="register-password" class="${registerPassword.className}" ${registerPassword.attrString} name="password" autocomplete="new-password" placeholder="Minimum 12 characters" />
            </div>
            <div>
              <label class="fe-label" for="register-confirm-password">Confirm Password</label>
              <input id="register-confirm-password" class="${registerConfirm.className}" ${registerConfirm.attrString} name="confirmPassword" autocomplete="new-password" placeholder="Repeat password" />
            </div>
          </div>
          <div>
            <label class="fe-label" for="register-role">Role</label>
            <div class="auth-role-menu">
              <input id="register-role" name="role" type="hidden" value="creator" />
              <button id="register-role-button" class="${registerRoleTrigger.className}" ${registerRoleTrigger.attrString} aria-haspopup="listbox" aria-expanded="false" aria-controls="register-role-menu">
                <span id="register-role-label">Creator</span>
                <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>
              </button>
              <div id="register-role-menu" class="auth-role-panel hidden" role="listbox" aria-label="Role options">
                <button class="${registerRoleCreator.className}" ${registerRoleCreator.attrString} data-role-value="creator">Creator</button>
                <button class="${registerRoleReviewer.className}" ${registerRoleReviewer.attrString} data-role-value="reviewer">Reviewer</button>
                <button class="${registerRoleAdmin.className}" ${registerRoleAdmin.attrString} data-role-value="admin">Admin</button>
              </div>
            </div>
          </div>
          <div class="rounded-brand-sm border border-brand-border bg-brand-surface-alt p-4">
            <div class="flex flex-wrap gap-2">
              <button id="register-send-otp" class="${registerSendOtp.className}" ${registerSendOtp.attrString}>Send OTP</button>
              <button id="register-verify-otp" class="${registerVerifyOtp.className}" ${registerVerifyOtp.attrString}>Verify OTP</button>
            </div>
            <label class="fe-label mt-3" for="register-otp-code">OTP Code</label>
            <input id="register-otp-code" class="${registerOtp.className}" ${registerOtp.attrString} name="otpCode" inputmode="numeric" placeholder="6-digit code" />
            <p id="register-otp-status" class="auth-subtle mt-2">Send OTP before account creation.</p>
          </div>
          <button class="${registerSubmit.className}" ${registerSubmit.attrString}>Create Account</button>
          <p id="register-feedback" class="auth-feedback hidden" aria-live="polite"></p>
        </form>

        <form id="forgot-form" data-auth-view="forgot" class="hidden space-y-4">
          <div>
            <label class="fe-label" for="forgot-email">Email</label>
            <input id="forgot-email" class="${forgotEmail.className}" ${forgotEmail.attrString} name="email" autocomplete="email" placeholder="name@company.com" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="fe-label" for="reset-password">New Password</label>
              <input id="reset-password" class="${resetPassword.className}" ${resetPassword.attrString} name="newPassword" autocomplete="new-password" placeholder="Minimum 12 characters" />
            </div>
            <div>
              <label class="fe-label" for="reset-confirm-password">Confirm New Password</label>
              <input id="reset-confirm-password" class="${resetConfirm.className}" ${resetConfirm.attrString} name="confirmPassword" autocomplete="new-password" placeholder="Repeat new password" />
            </div>
          </div>
          <div class="rounded-brand-sm border border-brand-border bg-brand-surface-alt p-4">
            <div class="flex flex-wrap gap-2">
              <button id="forgot-send-otp" class="${forgotSendOtp.className}" ${forgotSendOtp.attrString}>Send Reset OTP</button>
              <button id="forgot-verify-otp" class="${forgotVerifyOtp.className}" ${forgotVerifyOtp.attrString}>Verify OTP</button>
            </div>
            <label class="fe-label mt-3" for="forgot-otp-code">OTP Code</label>
            <input id="forgot-otp-code" class="${forgotOtp.className}" ${forgotOtp.attrString} name="otpCode" inputmode="numeric" placeholder="6-digit code" />
            <p id="forgot-otp-status" class="auth-subtle mt-2">Request an OTP to reset your password.</p>
          </div>
          <button class="${forgotSubmit.className}" ${forgotSubmit.attrString}>Reset Password</button>
          <p id="forgot-feedback" class="auth-feedback hidden" aria-live="polite"></p>
        </form>
      </div>
    </main>
  </div>
</section>`;
    }

    return { getTemplate: getTemplate };
});
