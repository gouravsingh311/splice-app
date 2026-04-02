/* Settings View — creator-safe profile and notification preferences */
(function (global, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (global && typeof global === 'object') { global.viewSettings = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    function getTemplate() {
        return `
<section class="fe-view hidden" data-view="settings" id="view-settings">
  <div class="fe-view-inner">
    <header class="fe-view-header">
      <div>
        <p class="fe-view-eyebrow">Account</p>
        <h2 class="fe-view-title">Creator Settings</h2>
        <p class="text-sm text-brand-text mt-1 opacity-80">Manage your creator profile context and notification preferences.</p>
      </div>
    </header>
    <div class="grid gap-6 lg:grid-cols-2">
      <div class="fe-card">
        <h3 class="fe-card-title mb-4">Profile Context</h3>
        <dl class="fe-dl">
          <dt class="fe-dt">Account ID</dt><dd class="fe-dd" id="actor-id">—</dd>
          <dt class="fe-dt">Current Role</dt><dd class="fe-dd" id="actor-roles">—</dd>
        </dl>
      </div>
      <div class="fe-card">
        <h3 class="fe-card-title mb-4">Workflow Boundary</h3>
        <p class="text-sm text-brand-text">Creator workflow routes are fixed to <strong>dashboard</strong>, <strong>submissions</strong>, <strong>notifications</strong>, and <strong>settings</strong>.</p>
        <p class="text-sm text-brand-text mt-3">For submission progress and review decisions, use <strong>notifications</strong> as your canonical inbox.</p>
      </div>
    </div>
    
    <div class="fe-card mt-6">
      <h3 class="fe-card-title mb-2">Security & Privacy</h3>
      <p class="text-sm text-brand-text mb-4 opacity-80">Configure application-level privacy controls.</p>
      
      <div class="flex items-center justify-between py-3 border-t border-brand-border/50">
        <div>
          <p class="font-medium text-brand-text">Screen Shield (Anti-Capture)</p>
          <p class="text-xs text-brand-text opacity-70 mt-0.5">Prevents the application window from being captured in screenshots, screen recordings, or screen sharing. <br/><span class="text-brand-accent italic" id="shield-platform-note"></span></p>
        </div>
        <label class="relative inline-flex cursor-pointer items-center">
          <input type="checkbox" id="privacy-shield-toggle" class="peer sr-only">
          <div class="h-6 w-11 rounded-full bg-brand-surface border border-brand-border after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:bg-brand-text after:transition-all after:content-[''] peer-checked:bg-brand-accent peer-checked:after:translate-x-full peer-checked:after:bg-white peer-disabled:opacity-50"></div>
        </label>
      </div>
    </div>

    <div class="fe-card mt-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 class="fe-card-title mb-2">Notification Preferences</h3>
          <p class="text-sm text-brand-text opacity-80">Preview only. These preferences mirror the creator-safe layout, but this screen does not persist edits yet.</p>
        </div>
        <span class="inline-flex w-fit items-center rounded-full border border-brand-border bg-brand-surface px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand-text">
          Preview only
        </span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="fe-checkbox-label cursor-not-allowed opacity-70" for="notif-pref-qc">
          <input id="notif-pref-qc" type="checkbox" class="h-4 w-4 accent-brand-accent" checked disabled aria-disabled="true" />
          QC failed / passed alerts
        </label>
        <label class="fe-checkbox-label cursor-not-allowed opacity-70" for="notif-pref-review">
          <input id="notif-pref-review" type="checkbox" class="h-4 w-4 accent-brand-accent" checked disabled aria-disabled="true" />
          Review status changes
        </label>
        <label class="fe-checkbox-label cursor-not-allowed opacity-70" for="notif-pref-release">
          <input id="notif-pref-release" type="checkbox" class="h-4 w-4 accent-brand-accent" checked disabled aria-disabled="true" />
          Release &amp; scheduling updates
        </label>
        <label class="fe-checkbox-label cursor-not-allowed opacity-70" for="notif-pref-email">
          <input id="notif-pref-email" type="checkbox" class="h-4 w-4 accent-brand-accent" disabled aria-disabled="true" />
          Email delivery (in addition to in-app)
        </label>
      </div>
    </div>
  </div>
</section>`;
    }

    async function wire() {
        const toggle = document.getElementById('privacy-shield-toggle');
        const note = document.getElementById('shield-platform-note');
        if (!toggle) return;

        const platform = window.spliceApp?.runtime?.platform;
        const isSupported = platform === 'win32' || platform === 'darwin';

        if (!isSupported) {
            toggle.disabled = true;
            toggle.parentElement.classList.add('cursor-not-allowed');
            note.textContent = `Not supported on ${platform || 'unknown platform'}.`;
            return;
        }

        note.textContent = 'Supported on Windows and macOS.';

        try {
            const status = await window.fileeaters.desktop.getPrivacyShieldStatus();
            toggle.checked = !!status.enabled;
        } catch (error) {
            console.error('Failed to get privacy shield status:', error);
        }

        toggle.addEventListener('change', async () => {
            const enabled = toggle.checked;
            try {
                const result = await window.fileeaters.desktop.setPrivacyShield(enabled);
                toggle.checked = !!result.enabled;
            } catch (error) {
                console.error('Failed to toggle privacy shield:', error);
                // Revert toggle state on failure
                toggle.checked = !enabled;
            }
        });
    }

    return { getTemplate: getTemplate, wire: wire };
});
