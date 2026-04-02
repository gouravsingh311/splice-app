/* Notifications View — inbox with unread/read grouping */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.viewNotifications = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function getFlowbiteWrappers() {
    if (typeof globalThis !== 'undefined' && globalThis.flowbiteWrappers) { return globalThis.flowbiteWrappers; }
    if (typeof window !== 'undefined' && window.flowbiteWrappers) { return window.flowbiteWrappers; }
    return null;
  }

  function wrapControl(name, options, fallbackClass) {
    var wrappers = getFlowbiteWrappers();
    if (wrappers && typeof wrappers[name] === 'function') {
      return wrappers[name](options || {});
    }
    var className = fallbackClass || ((options && options.className) || '');
    return {
      className: className,
      attrs: {},
      attrString: '',
    };
  }

  function formatWrapperAttrs(wrapper) {
    if (!wrapper || !wrapper.attrString) { return ''; }
    return ' ' + wrapper.attrString;
  }

  function buttonFallbackClass(tone) {
    var base = 'inline-flex items-center justify-center gap-2 rounded-brand-sm border px-4 py-2 text-sm font-semibold transition duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent';
    if (tone === 'ghost') {
      return base + ' border-transparent bg-transparent text-brand-text hover:bg-brand-surface-alt';
    }
    return base + ' border-brand-border bg-brand-surface text-brand-text hover:bg-brand-surface-alt';
  }

  function selectFallbackClass() {
    return 'w-full rounded-brand-sm border border-brand-border bg-brand-surface-alt px-3 py-2 text-sm text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent';
  }

  function getTemplate() {
    var markAllButton = wrapControl('button', {
      control: 'notifications-mark-all',
      testId: 'notifications-mark-all-button',
      tone: 'secondary',
      size: 'md',
      className: 'gap-2',
    }, buttonFallbackClass('secondary'));

    var refreshButton = wrapControl('button', {
      control: 'notifications-refresh',
      testId: 'notifications-load-button',
      tone: 'ghost',
      size: 'md',
      className: 'gap-2',
    }, buttonFallbackClass('ghost'));

    var typeSelect = wrapControl('select', {
      control: 'notifications-type',
      testId: 'notifications-type-filter',
    }, selectFallbackClass());
    var typeTrigger = wrapControl('dropdownTrigger', {
      control: 'notifications-type-trigger',
      testId: 'notifications-type-trigger',
    }, '');

    var severitySelect = wrapControl('select', {
      control: 'notifications-severity',
      testId: 'notifications-severity-filter',
    }, selectFallbackClass());
    var severityTrigger = wrapControl('dropdownTrigger', {
      control: 'notifications-severity-trigger',
      testId: 'notifications-severity-trigger',
    }, '');

    var statusSelect = wrapControl('select', {
      control: 'notifications-status',
      testId: 'notifications-status-filter',
    }, selectFallbackClass());
    var statusTrigger = wrapControl('dropdownTrigger', {
      control: 'notifications-status-trigger',
      testId: 'notifications-status-trigger',
    }, '');

    return `
<section class="fe-view hidden" data-view="notifications" id="view-notifications" aria-labelledby="notifications-title">
  <div class="fe-view-inner mx-auto w-full max-w-[1100px] space-y-6 px-8 py-8">
    <header class="notification-header-shell md:flex-row md:items-end md:justify-between">
      <div>
        <p class="fe-view-eyebrow">Inbox</p>
        <h2 class="fe-view-title" id="notifications-title" data-view-title>Notifications</h2>
        <p class="mt-2 text-sm text-brand-text/75">Review updates, take the next creator action, and keep your submission pipeline moving.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span id="notifications-role-chip" class="notification-role-chip" data-testid="notifications-role-chip">ROLE: CREATOR</span>
        <p id="notifications-count-summary" class="notification-count-chip" data-testid="notifications-count-summary">
          UNREAD <span id="notifications-unread-count" data-testid="notifications-unread-count" data-count="0">0</span>
          OF <span id="notifications-total-count" data-testid="notifications-total-count" data-count="0">0</span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button id="notifications-mark-all-button" data-testid="notifications-mark-all-button" class="notification-action-primary ${markAllButton.className}"${formatWrapperAttrs(markAllButton)} aria-label="Mark all unread notifications as read">
          <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0Z" clip-rule="evenodd"/></svg>
          Mark All Read
        </button>
        <button id="notifications-load-button" data-testid="notifications-load-button" class="notification-action-secondary ${refreshButton.className} border-brand-border bg-brand-bg text-brand-text"${formatWrapperAttrs(refreshButton)} aria-label="Refresh notifications">
          <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.38 2.12l-1.414 1.414a7.5 7.5 0 0 0 12.572-3.003 1 1 0 1 0-1.778-.531ZM4.688 8.576a5.5 5.5 0 0 1 9.38-2.12l1.414-1.414A7.5 7.5 0 0 0 2.91 8.045a1 1 0 1 0 1.778.531Z" clip-rule="evenodd"/></svg>
          Refresh
        </button>
      </div>
    </header>

    <section class="notification-filter-shell">
      <div class="flex items-center gap-3">
        <svg class="h-5 w-5 text-brand-text opacity-70" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M3 3a1 1 0 0 1 1-1h12a1 1 0 0 1 .707 1.707L12 9.414V15a1 1 0 0 1-.293.707l-2 2A1 1 0 0 1 8 17v-7.586L3.293 4.707A1 1 0 0 1 3 3Z" clip-rule="evenodd"/></svg>
        <p class="notification-section-title">Filters</p>
      </div>
      <input id="notifications-active-role" type="hidden" value="creator" data-testid="notifications-active-role" />
      <div class="notification-filter-grid">
        <div class="ui-dropdown notification-filter" data-ui-dropdown>
          <label class="sr-only" for="notifications-type-filter">Notification type filter</label>
          <select id="notifications-type-filter" data-testid="notifications-type-filter" class="hidden"${formatWrapperAttrs(typeSelect)} aria-label="Notification type filter">
            <option value="">All</option>
            <option value="qc_failed">QC Failed</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="scheduled">Scheduled</option>
            <option value="released">Released</option>
          </select>
          <button id="notifications-type-trigger" class="notification-filter-trigger ${typeTrigger.className}"${formatWrapperAttrs(typeTrigger)} type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="notifications-type-menu">
            <span id="notifications-type-label">All</span>
            <svg class="notification-filter-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div id="notifications-type-menu" class="ui-dropdown-menu notification-filter-menu hidden" role="listbox">
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="">All</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="qc_failed">QC Failed</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="submitted">Submitted</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="under_review">Under Review</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="approved">Approved</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="rejected">Rejected</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="scheduled">Scheduled</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="released">Released</button>
          </div>
        </div>

        <div class="ui-dropdown notification-filter" data-ui-dropdown>
          <label class="sr-only" for="notifications-severity-filter">Notification severity filter</label>
          <select id="notifications-severity-filter" data-testid="notifications-severity-filter" class="hidden"${formatWrapperAttrs(severitySelect)} aria-label="Notification severity filter">
            <option value="">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
          <button id="notifications-severity-trigger" class="notification-filter-trigger ${severityTrigger.className}"${formatWrapperAttrs(severityTrigger)} type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="notifications-severity-menu">
            <span id="notifications-severity-label">All</span>
            <svg class="notification-filter-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div id="notifications-severity-menu" class="ui-dropdown-menu notification-filter-menu hidden" role="listbox">
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="">All</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="info">Info</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="warning">Warning</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="error">Error</button>
          </div>
        </div>

        <div class="ui-dropdown notification-filter" data-ui-dropdown>
          <label class="sr-only" for="notifications-status-filter">Notification delivery status filter</label>
          <select id="notifications-status-filter" data-testid="notifications-status-filter" class="hidden"${formatWrapperAttrs(statusSelect)} aria-label="Notification delivery status filter">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <button id="notifications-status-trigger" class="notification-filter-trigger ${statusTrigger.className}"${formatWrapperAttrs(statusTrigger)} type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="notifications-status-menu">
            <span id="notifications-status-label">All</span>
            <svg class="notification-filter-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div id="notifications-status-menu" class="ui-dropdown-menu notification-filter-menu hidden" role="listbox">
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="">All</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="pending">Pending</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="sent">Sent</button>
            <button type="button" data-dropdown-option class="notification-filter-option" data-value="failed">Failed</button>
          </div>
        </div>
      </div>

      <p id="notifications-next-step-guidance" class="notification-guidance" data-testid="notifications-next-step-guidance">Select Refresh to load your latest updates, then use each notification action to keep submissions moving.</p>
      <p id="notifications-feedback" class="auth-feedback hidden text-xs font-medium text-brand-text" aria-live="polite" data-testid="notifications-feedback"></p>
    </section>

    <div id="notifications-list" class="space-y-6" data-testid="notifications-list" data-visible-count="0">
      <section id="notifications-unread-section" class="notification-list-section notification-list-section-unread" data-testid="notifications-unread-section" aria-labelledby="notifications-unread-heading">
        <div class="flex items-center justify-between gap-3">
          <h3 id="notifications-unread-heading" class="notification-list-heading">Unread <span id="notifications-unread-count-inline" class="notification-list-heading-count">(0)</span></h3>
        </div>
        <div id="notifications-unread-list" class="notification-list-shell notification-list-shell-unread" data-testid="notifications-unread-list"></div>
      </section>
      <section id="notifications-read-section" class="notification-list-section notification-list-section-read" data-testid="notifications-read-section" aria-labelledby="notifications-read-heading">
        <div class="flex items-center justify-between gap-3">
          <h3 id="notifications-read-heading" class="notification-list-heading">Read <span id="notifications-read-count" class="notification-list-heading-count">(0)</span></h3>
        </div>
        <div id="notifications-read-list" class="notification-list-shell notification-list-shell-read" data-testid="notifications-read-list"></div>
      </section>
    </div>
  </div>
</section>`;
  }

  return { getTemplate: getTemplate };
});
