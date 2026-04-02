/* Dashboard View */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.viewDashboard = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var state = {
    submissions: [],
    unreadCount: 0,
    loaded: false,
    loading: false,
    submissionsLoadState: 'idle',
    submissionsErrorMessage: '',
  };

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

  function bridge() {
    if (typeof window === 'undefined') { return null; }
    return window.electronAPI || window.fileeaters || null;
  }

  function getActorId() {
    if (typeof document === 'undefined') { return 'desktop-local'; }
    var actorEl = document.getElementById('actor-id');
    if (!actorEl) { return 'desktop-local'; }
    var value = String(actorEl.textContent || '').trim();
    return value && value !== '—' ? value : 'desktop-local';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusChip(status) {
    var safe = String(status || 'draft').toLowerCase();
    var cls = safe === 'under_review' ? 'under-review' : safe;
    return '<span class="fe-status-chip ' + cls + '">' + escapeHtml(safe.replace('_', ' ')) + '</span>';
  }

  function humanizeUploadStatus(status) {
    switch (String(status || '').trim().toLowerCase()) {
      case 'queued':
        return 'Upload queued in the background';
      case 'in_progress':
        return 'Uploading files to Dropbox';
      case 'completed':
        return 'Upload complete';
      case 'failed':
        return 'Upload failed';
      default:
        return 'Preparing upload';
    }
  }

  function buildUploadProgressMarkup(submission) {
    if (!submission || String(submission.currentState || '').toLowerCase() !== 'uploading') {
      return '';
    }

    var progress = Number.isInteger(submission.uploadProgressPercent)
      ? submission.uploadProgressPercent
      : 0;
    var statusText = humanizeUploadStatus(submission.uploadStatus);

    return (
      '<div class="mt-2 w-full rounded-lg border border-brand-border bg-brand-bg p-2">' +
      '<progress class="w-full" max="100" value="' + progress + '"></progress>' +
      '<div class="mt-1 flex items-center justify-between gap-2">' +
      '<span class="text-[11px] text-brand-text">' + escapeHtml(statusText) + '</span>' +
      '<span class="text-[11px] font-semibold text-brand-text-strong">' + progress + '%</span>' +
      '</div>' +
      '</div>'
    );
  }

  function toIsoDate(value) {
    if (!value) { return ''; }
    try {
      return new Date(value).toISOString();
    } catch (_) {
      return '';
    }
  }

  function formatShortDate(value) {
    var iso = toIsoDate(value);
    if (!iso) { return '—'; }
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date(iso));
    } catch (_) {
      return iso.slice(0, 10);
    }
  }

  function sortSubmissionsByRecent(items) {
    return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
      var aTime = Date.parse(a && (a.updatedAt || a.createdAt || '')) || 0;
      var bTime = Date.parse(b && (b.updatedAt || b.createdAt || '')) || 0;
      return bTime - aTime;
    });
  }

  function resolveRecentActivityLaunchTarget(submission) {
    var currentState = String(submission && submission.currentState || '').trim().toLowerCase();
    var isDraft = currentState === 'draft' || currentState === 'reopened';
    var packName = String(submission && (submission.packName || submission.submissionId || 'Untitled Submission'));
    return {
      shortcut: 'open-submission',
      submissionId: String(submission && submission.submissionId || ''),
      mode: isDraft ? 'draft' : 'detail',
      actionLabel: isDraft ? 'Resume draft' : 'View details',
      ariaLabel: (isDraft ? 'Resume draft submission ' : 'View submission details for ') + packName,
    };
  }

  function computeKpis(submissions) {
    var items = Array.isArray(submissions) ? submissions : [];
    return {
      total: items.length,
      underReview: items.filter(function (item) {
        return String(item && item.currentState || '').toLowerCase() === 'under_review';
      }).length,
      approved: items.filter(function (item) {
        return String(item && item.currentState || '').toLowerCase() === 'approved';
      }).length,
      qcFailed: items.filter(function (item) {
        return String(item && item.currentState || '').toLowerCase() === 'qc_failed';
      }).length,
    };
  }

  function buildRecentActivityRows(submissions) {
    if (state.loading && !state.loaded) {
      return '<tr><td class="fe-td-empty" colspan="3">Loading recent activity...</td></tr>';
    }
    if (state.submissionsLoadState === 'error') {
      return '<tr><td class="fe-td-empty" colspan="3">' + escapeHtml(state.submissionsErrorMessage) + '</td></tr>';
    }
    var recent = sortSubmissionsByRecent(submissions).slice(0, 4);
    if (recent.length === 0) {
      return '<tr><td class="fe-td-empty" colspan="3">No creator submissions yet. Use Create New Pack to start the canonical submissions workflow.</td></tr>';
    }
    return recent.map(function (submission) {
      var launchTarget = resolveRecentActivityLaunchTarget(submission);
      var title = submission.packName || submission.submissionId || 'Untitled Submission';
      var statusLabel = String(submission.currentState || 'draft').replace('_', ' ');
      return (
        '<tr class="group">' +
        '<td class="fe-td p-0" colspan="3">' +
        '<button type="button" class="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors duration-150 hover:bg-brand-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" ' +
        'data-nav="submissions" data-submissions-shortcut="' + launchTarget.shortcut + '" data-submission-id="' + launchTarget.submissionId + '" data-submissions-mode="' + launchTarget.mode + '" aria-label="' + escapeHtml(launchTarget.ariaLabel) + '">' +
        '<span class="min-w-0 flex-1">' +
        '<span class="block truncate text-sm font-semibold text-brand-text-strong">' + escapeHtml(title) + '</span>' +
        '<span class="mt-0.5 block text-xs text-brand-text">Submitted ' + escapeHtml(formatShortDate(submission.createdAt || submission.updatedAt)) + '</span>' +
        buildUploadProgressMarkup(submission) +
        '</span>' +
        '<span class="flex shrink-0 items-center gap-3">' +
        statusChip(submission.currentState) +
        '<span class="hidden rounded-full border border-brand-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-text sm:inline-flex">' + escapeHtml(launchTarget.actionLabel) + '</span>' +
        '<span class="sr-only">Current state ' + escapeHtml(statusLabel) + '</span>' +
        '</span>' +
        '</button>' +
        '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderKpis() {
    var kpis = computeKpis(state.submissions);
    var totalEl = document.getElementById('dashboard-kpi-total');
    var reviewEl = document.getElementById('dashboard-kpi-under-review');
    var approvedEl = document.getElementById('dashboard-kpi-approved');
    var failedEl = document.getElementById('dashboard-kpi-qc-failed');
    var unreadEl = document.getElementById('stat-unread-notifs');
    if (totalEl) { totalEl.textContent = String(kpis.total); }
    if (reviewEl) { reviewEl.textContent = String(kpis.underReview); }
    if (approvedEl) { approvedEl.textContent = String(kpis.approved); }
    if (failedEl) { failedEl.textContent = String(kpis.qcFailed); }
    if (unreadEl) { unreadEl.textContent = String(state.unreadCount); }
  }

  function renderRecentActivity() {
    var body = document.getElementById('dashboard-recent-activity-body');
    if (!body) { return; }
    body.innerHTML = buildRecentActivityRows(state.submissions);
  }

  function renderLoadingState() {
    var loadingEl = document.getElementById('dashboard-loading-indicator');
    if (!loadingEl) { return; }
    if (state.loading) {
      loadingEl.classList.remove('hidden');
      loadingEl.setAttribute('aria-busy', 'true');
      return;
    }
    loadingEl.classList.add('hidden');
    loadingEl.removeAttribute('aria-busy');
  }

  function renderStatusGuidance() {
    var containerEl = document.getElementById('dashboard-submissions-error');
    var statusEl = document.getElementById('dashboard-submissions-status');
    if (!statusEl || !containerEl) { return; }
    if (state.submissionsLoadState === 'error') {
      containerEl.classList.remove('hidden');
      statusEl.classList.remove('hidden');
      statusEl.innerHTML = (
        '<p class="font-semibold text-brand-text-strong">Dashboard data is temporarily unavailable.</p>' +
        '<p class="mt-1">Next step: confirm the FileEaters backend service is running, verify your network connection, then select Retry Dashboard Data.</p>'
      );
      return;
    }
    containerEl.classList.add('hidden');
    statusEl.classList.add('hidden');
    statusEl.innerHTML = '';
  }

  function render() {
    renderKpis();
    renderStatusGuidance();
    renderRecentActivity();
    renderLoadingState();
  }

  function isBackendUnavailableError(error) {
    if (!error || typeof error !== 'object') { return false; }
    var code = String(error.code || '').toUpperCase();
    var reason = String(error.reason || '').toUpperCase();
    var message = String(error.message || '').toLowerCase();
    if (code === 'INTERNAL_ERROR') { return true; }
    if (reason.indexOf('UNREACHABLE') >= 0 || reason.indexOf('UNAVAILABLE') >= 0) { return true; }
    return message.indexOf('unreachable') >= 0 || message.indexOf('unavailable') >= 0;
  }

  function setSubmissionsLoadError(error) {
    state.submissions = [];
    state.submissionsLoadState = 'error';
    if (isBackendUnavailableError(error)) {
      state.submissionsErrorMessage = 'Submission service unavailable. Start the backend service, check connectivity, then retry dashboard data.';
      return;
    }
    state.submissionsErrorMessage = 'Unable to load creator submissions right now. Retry dashboard data in a moment.';
  }

  async function loadDashboardData() {
    var api = bridge();
    if (!api || state.loading) { return; }
    state.loading = true;
    renderLoadingState();
    var actorId = getActorId();
    try {
      if (api.submissions && typeof api.submissions.list === 'function') {
        try {
          var submissionsResponse = await api.submissions.list({ creatorId: actorId });
          if (submissionsResponse && submissionsResponse.ok) {
            state.submissions = Array.isArray(submissionsResponse.data && submissionsResponse.data.submissions)
              ? submissionsResponse.data.submissions
              : [];
            state.submissionsLoadState = 'ready';
            state.submissionsErrorMessage = '';
          } else {
            setSubmissionsLoadError(submissionsResponse && submissionsResponse.error ? submissionsResponse.error : null);
          }
        } catch (error) {
          setSubmissionsLoadError(error);
        }
      } else {
        setSubmissionsLoadError({ code: 'INTERNAL_ERROR', reason: 'SUBMISSIONS_API_UNAVAILABLE', message: 'Submission API unavailable' });
      }

      if (api.notifications && typeof api.notifications.list === 'function') {
        try {
          var notificationsResponse = await api.notifications.list({
            actorId: actorId,
            actorRole: 'creator',
            includeRead: true,
          });
          if (notificationsResponse && notificationsResponse.ok) {
            var notifications = Array.isArray(notificationsResponse.data && notificationsResponse.data.notifications)
              ? notificationsResponse.data.notifications
              : [];
            state.unreadCount = notifications.filter(function (item) { return !item.read; }).length;
          }
        } catch (_) {
          state.unreadCount = 0;
        }
      }
      state.loaded = true;
      render();
    } finally {
      state.loading = false;
      renderLoadingState();
    }
  }

  function handleRetryClick(event) {
    if (event) { event.preventDefault(); }
    return refresh();
  }

  function wireRetryButton() {
    var retryButton = document.getElementById('dashboard-retry-load');
    if (!retryButton) { return; }
    retryButton.addEventListener('click', handleRetryClick);
  }

  function refresh() {
    render();
    return loadDashboardData();
  }

  function getTemplate() {
    var openInboxBtn = wrapControl('button', {
      control: 'dashboard-open-inbox',
      type: 'button',
      tone: 'secondary',
      className: 'min-w-[120px]',
    });
    var retryBtn = wrapControl('button', {
      control: 'dashboard-retry-load',
      type: 'button',
      tone: 'secondary',
    });
    var createPackBtn = wrapControl('button', {
      control: 'dashboard-create-pack',
      type: 'button',
      tone: 'primary',
      size: 'lg',
      className: 'min-w-[170px]',
    });
    var viewHistoryBtn = wrapControl('button', {
      control: 'dashboard-view-history',
      type: 'button',
      tone: 'ghost',
      size: 'sm',
      className: 'px-0 py-0 text-sm font-semibold text-brand-text-strong underline underline-offset-4',
    });
    return `
<section class="fe-view hidden" data-view="dashboard" id="view-dashboard">
  <div class="fe-view-inner mx-auto w-full max-w-[1100px] space-y-6 px-8 py-8">
    <header class="fe-view-header mb-0 items-center">
      <div>
        <h2 class="fe-view-title" data-view-title>Dashboard</h2>
        <p class="mt-2 text-sm text-brand-text/75">Welcome back to your creator dashboard.</p>
      </div>
      <button class="${openInboxBtn.className}" ${openInboxBtn.attrString} data-nav="notifications">Open Inbox</button>
    </header>

    <section id="dashboard-loading-indicator" class="hidden rounded-[16px] border border-brand-border/30 bg-brand-bg/80 px-4 py-3 text-sm text-brand-text shadow-[0_8px_20px_rgba(35,35,35,0.08)]" role="status" aria-live="polite">
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 animate-pulse rounded-full bg-brand-accent"></span>
        <span>Loading dashboard data...</span>
      </div>
    </section>

    <section id="dashboard-submissions-error" class="hidden rounded-[16px] border border-brand-danger/40 bg-brand-bg p-4 text-sm text-brand-danger shadow-[0_8px_20px_rgba(35,35,35,0.08)]">
      <div id="dashboard-submissions-status" role="status" aria-live="polite"></div>
      <div class="mt-3 flex justify-end">
        <button class="${retryBtn.className}" ${retryBtn.attrString} id="dashboard-retry-load">Retry Dashboard Data</button>
      </div>
    </section>

    <section class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" id="dashboard-kpis">
      <div class="fe-kpi-card">
        <p class="fe-stat-label">Total</p>
        <p class="fe-stat-value" id="dashboard-kpi-total">0</p>
      </div>
      <div class="fe-kpi-card">
        <p class="fe-stat-label">Under Review</p>
        <p class="fe-stat-value" id="dashboard-kpi-under-review">0</p>
      </div>
      <div class="fe-kpi-card">
        <p class="fe-stat-label">Approved</p>
        <p class="fe-stat-value" id="dashboard-kpi-approved">0</p>
      </div>
      <div class="fe-kpi-card">
        <p class="fe-stat-label">QC Failed</p>
        <p class="fe-stat-value" id="dashboard-kpi-qc-failed">0</p>
      </div>
    </section>

    <section id="dashboard-hero-cta" class="rounded-[20px] bg-brand-bg/95 p-8 shadow-[0_16px_34px_rgba(35,35,35,0.05)]">
      <div class="mx-auto max-w-2xl">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-brand-border/40 bg-brand-bg">
          <svg class="h-8 w-8 text-brand-text-strong" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.586A2.25 2.25 0 0 1 12.427 2.66l3.913 3.913A2.25 2.25 0 0 1 17 8.164v7.586A2.25 2.25 0 0 1 14.75 18h-9.5A2.25 2.25 0 0 1 3 15.75v-11.5ZM10 6a.75.75 0 0 1 .75.75V9.25H13.25a.75.75 0 0 1 0 1.5H10.75v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 10 6Z" clip-rule="evenodd" />
          </svg>
        </div>
        <h3 class="mt-6 font-ui text-3xl font-medium text-brand-text-strong">Start New Pack Submission</h3>
        <p class="mt-2 text-sm text-brand-text/75">Upload your latest audio packs and start the review process for FileEaters Enterprise.</p>
        <div class="mt-6 flex justify-center">
          <button class="${createPackBtn.className}" ${createPackBtn.attrString} data-nav="submissions" data-submissions-shortcut="create" id="dashboard-create-pack">Create New Pack</button>
        </div>
      </div>
    </section>

    <section class="rounded-[20px] bg-brand-bg/95 p-0 shadow-[0_16px_34px_rgba(35,35,35,0.05)]">
      <div class="mb-4 flex items-end justify-between gap-4">
        <h3 class="px-5 pt-5 font-ui text-4xl font-medium text-brand-text-strong">Recent Activity</h3>
        <button class="${viewHistoryBtn.className}" ${viewHistoryBtn.attrString} data-nav="submissions" data-submissions-shortcut="history" id="dashboard-view-history">View All History</button>
      </div>
      <div class="overflow-hidden rounded-b-[20px]">
        <div class="fe-table-wrap rounded-none border-x-0 border-b-0 border-t border-brand-border/20">
          <table class="fe-table" id="dashboard-recent-activity-table">
            <thead>
              <tr>
                <th class="fe-th">Pack Name</th>
                <th class="fe-th">Date Submitted</th>
                <th class="fe-th">Status</th>
              </tr>
            </thead>
            <tbody id="dashboard-recent-activity-body">
              <tr><td class="fe-td-empty" colspan="3">Loading recent activity...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</section>`;
  }

  function wire() {
    var root = document.getElementById('view-dashboard');
    if (!root) { return; }
    wireRetryButton();
    refresh();
  }

  return {
    getTemplate: getTemplate,
    wire: wire,
    refresh: refresh,
    __test: {
      buildRecentActivityRows: buildRecentActivityRows,
      resolveRecentActivityLaunchTarget: resolveRecentActivityLaunchTarget,
    },
  };
});
