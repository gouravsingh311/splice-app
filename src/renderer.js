/**
 * renderer.js — Main orchestrator for the FileEaters Enterprise desktop renderer.
 *
 * Responsibilities:
 *  1. Inject all view HTML templates into #view-mount
 *  2. Wire sidebar navigation (view switching, role guards)
 *  3. Wire Auth flows (login, register, forgot/reset) — preserved for test compat
 *  4. Wire QC admin flows — preserved for test compat
 *  5. Wire Notification Center — preserved for test compat
 *  6. Wire Operations flows — preserved for test compat
 *  7. Call view-module wire() functions for new views
 *  8. Bootstrap session context
 */

/* ── API Bridge ── */
if (typeof window !== 'undefined' && !window.electronAPI && window.fileeaters) {
  window.electronAPI = window.fileeaters;
}
var api = (typeof window !== 'undefined' && (window.electronAPI || window.fileeaters))
  ? (window.electronAPI || window.fileeaters)
  : null;
var authUiState = (typeof window !== 'undefined' && window.authUiState) ? window.authUiState : {};
var qcGuidanceCatalog = (typeof window !== 'undefined' && window.qcGuidanceCatalog) ? window.qcGuidanceCatalog : null;
var routePolicy = (typeof window !== 'undefined' && window.workspaceRoutePolicy)
  ? window.workspaceRoutePolicy
  : {
      resolveRoute: function (requestedViewId, roles) {
        var deprecated = ['upload-qc', 'qc-results', 'submission-detail'];
        var canonicalAliases = {
          'submissions-history': 'submissions',
        };
        var normalizedRoles = Array.isArray(roles) ? roles : [];
        var creatorScoped = normalizedRoles.length === 0 || normalizedRoles.indexOf('creator') !== -1;
        if (canonicalAliases[requestedViewId]) {
          return {
            requestedView: requestedViewId,
            resolvedView: canonicalAliases[requestedViewId],
            redirected: true,
            reason: 'Route alias normalized to canonical view.',
          };
        }
        if (creatorScoped && deprecated.indexOf(requestedViewId) !== -1) {
          return {
            requestedView: requestedViewId,
            resolvedView: 'submissions',
            redirected: true,
            reason: 'Creator workflow now runs in Submissions.',
          };
        }
        return {
          requestedView: requestedViewId,
          resolvedView: requestedViewId,
          redirected: false,
          reason: '',
        };
      },
    };

/* ── App State ── */
var appState = {
  actor: { id: '', roles: [] },
  register: { otpVerificationToken: null },
  forgot: { otpVerificationToken: null },
  adminViewWired: false,
};

var notificationState = {
  actorId: 'desktop-local',
  actorRole: 'creator',
  notifications: [],
};
var notificationDropdownController = null;

var qcState = {
  activeSubmissionId: 'sub-local-1',
  activeRunIdBySubmissionId: {},
  severityFilter: 'all',
  categoryFilter: 'all',
  runsBySubmissionId: {},
  knownSubmissions: [],
  hydrationStateBySubmissionId: {},
};

var dropboxSetupState = {
  dismissedForSession: false,
  wired: false,
  visible: false,
  hasAppCredentials: false,
  oauthSessionId: null,
  oauthPollTimer: null,
};

var profileMenuState = {
  wired: false,
  open: false,
};

var DEPRECATED_CREATOR_ROUTE_REDIRECTS = {
  'upload-qc': 'submissions',
  'qc-results': 'submissions',
  'submission-detail': 'submissions',
};

function setBodyActiveView(viewId) {
  if (typeof document === 'undefined' || !document.body || typeof document.body.setAttribute !== 'function') {
    return;
  }
  document.body.setAttribute('data-active-view', viewId || 'auth');
}

function setNavigationEnabled(enabled) {
  if (typeof document.querySelectorAll !== 'function') { return; }
  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    var isAuthRouteButton = btn.dataset && btn.dataset.nav === 'auth';
    var shouldEnable = enabled || isAuthRouteButton;
    btn.disabled = !shouldEnable;
    if (shouldEnable) {
      btn.removeAttribute('tabindex');
      btn.removeAttribute('aria-disabled');
    } else {
      btn.setAttribute('tabindex', '-1');
      btn.setAttribute('aria-disabled', 'true');
    }
  });
}

function closeProfileMenu() {
  if (typeof document === 'undefined') { return; }
  var trigger = document.getElementById('profile-menu-trigger');
  var panel = document.getElementById('profile-menu-panel');
  if (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('is-open');
  }
  if (panel) {
    panel.classList.add('hidden');
  }
  profileMenuState.open = false;
}

function clearAuthenticatedShellContext() {
  appState.actor = { id: '', roles: [] };
  notificationState.actorId = 'desktop-local';
  notificationState.actorRole = 'creator';

  setText('actor-id', '—');
  setText('actor-roles', '—');

  var badge = document.getElementById('sidebar-role-badge');
  if (badge) {
    badge.textContent = '—';
  }
  var label = document.getElementById('sidebar-actor-label');
  if (label) {
    label.textContent = '';
  }

  applyRoleGuards([]);
  configureNotificationRoleScope('creator');

  var notifRole = document.getElementById('notifications-role') || document.getElementById('notifications-active-role');
  if (notifRole) {
    notifRole.value = 'creator';
  }
}

function focusViewEntryPoint(viewId) {
  if (typeof document.getElementById !== 'function' || typeof document.querySelector !== 'function') { return; }
  if (viewId === 'auth') {
    var loginInput = document.getElementById('login-email');
    if (loginInput && typeof loginInput.focus === 'function') {
      loginInput.focus();
    }
    return;
  }
  var viewRoot = document.querySelector('[data-view="' + viewId + '"]');
  if (!viewRoot || typeof viewRoot.querySelector !== 'function') { return; }
  var heading = viewRoot.querySelector('[data-view-title]') || viewRoot.querySelector('h1, h2, h3');
  if (heading && typeof heading.focus === 'function') {
    if (!heading.hasAttribute('tabindex')) {
      heading.setAttribute('tabindex', '-1');
    }
    heading.setAttribute('data-focus-managed', viewId);
    heading.focus();
  }
}

/* ═══════════════════════════════════════════════════════════
   DOM UTILITIES
═══════════════════════════════════════════════════════════ */

function setValue(id, val) {
  var el = document.getElementById(id);
  if (el) { el.value = String(val != null ? val : ''); }
}

function getValue(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function getChecked(id) {
  var el = document.getElementById(id);
  return el ? el.checked : false;
}

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) { el.textContent = String(val != null ? val : ''); }
}

function setButtonBusy(button, isBusy) {
  if (!button) { return; }
  button.disabled = isBusy;
  if (isBusy) {
    button.dataset.originalText = button.textContent;
    button.textContent = 'Working…';
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function setFeedback(id, tone, message) {
  var el = document.getElementById(id);
  if (!el) { return; }
  if (!tone && !message) {
    el.textContent = '';
    el.className = 'auth-feedback hidden';
    return;
  }
  el.textContent = message;
  /* Set className explicitly — does not include 'hidden', making element visible */
  el.className = 'auth-feedback ' + (tone || '');
}

function toPrettyJson(obj) {
  try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mapApiErrorToFeedback(error, fallback) {
  if (!error) { return { tone: 'error', message: fallback }; }
  var msg = (error.message && error.message.trim()) || fallback;
  return { tone: 'error', message: msg };
}

/* ═══════════════════════════════════════════════════════════
   VIEW INJECTION & NAVIGATION
═══════════════════════════════════════════════════════════ */

var VIEW_MODULES = [
  typeof window !== 'undefined' && window.viewAuth,
  typeof window !== 'undefined' && window.viewDashboard,
  typeof window !== 'undefined' && window.viewUploadQc,
  typeof window !== 'undefined' && window.viewQcResults,
  typeof window !== 'undefined' && window.viewSubmissions,
  typeof window !== 'undefined' && window.viewSubmissionDetail,
  typeof window !== 'undefined' && window.viewReviewerQueue,
  typeof window !== 'undefined' && window.viewReviewerDecision,
  typeof window !== 'undefined' && window.viewNotifications,
  typeof window !== 'undefined' && window.viewAdminOps,
  typeof window !== 'undefined' && window.viewSettings,
];

function injectViews() {
  if (typeof document.getElementById !== 'function') { return; }
  var mount = document.getElementById('view-mount');
  if (!mount) { return; }
  VIEW_MODULES.forEach(function (mod) {
    if (!mod || typeof mod.getTemplate !== 'function') { return; }
    try {
      mount.insertAdjacentHTML('beforeend', mod.getTemplate());
    } catch (error) {
      if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
        console.error('[renderer] view injection failed', error);
      }
    }
  });
}

function resolveNavigableView(viewId) {
  if (!viewId) { return viewId; }
  var resolved = routePolicy.resolveRoute(viewId, appState.actor.roles || []);
  if (resolved && resolved.redirected) {
    if (typeof window !== 'undefined') {
      window.__workspaceRouteNotice = resolved.reason;
    }
    return resolved.resolvedView;
  }
  return viewId;
}

function navigateTo(viewId) {
  if (typeof document.querySelectorAll !== 'function' || typeof document.querySelector !== 'function') { return; }
  var normalizedViewId = resolveNavigableView(viewId);
  closeProfileMenu();
  /* Hide all views */
  var allViews = document.querySelectorAll('[data-view]');
  allViews.forEach(function (v) { v.classList.add('hidden'); });

  /* Show target */
  var target = document.querySelector('[data-view="' + normalizedViewId + '"]');
  if (!target) {
    normalizedViewId = 'dashboard';
    target = document.querySelector('[data-view="dashboard"]');
  }
  setBodyActiveView(normalizedViewId);
  if (target) { target.classList.remove('hidden'); }

  /* Update nav active state */
  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    var isActive = btn.dataset.nav === normalizedViewId;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  if (typeof window !== 'undefined' && normalizedViewId === 'dashboard' && window.viewDashboard && window.viewDashboard.refresh) {
    window.viewDashboard.refresh();
  }

  setNavigationEnabled(normalizedViewId !== 'auth');
  focusViewEntryPoint(normalizedViewId);
}

function wireNav() {
  if (typeof document.addEventListener !== 'function') { return; }
  document.addEventListener('click', function (e) {
    var btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-nav]') : null;
    if (!btn) { return; }
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') { return; }
    e.preventDefault();
    var target = resolveNavigableView(btn.dataset.nav);
    if (target === 'auth') {
      setNavigationEnabled(false);
      navigateTo('auth');
      setActiveTab('login');
      return;
    }
    navigateTo(target);
    if (typeof window !== 'undefined' && target === 'submissions' && btn.dataset.submissionsShortcut) {
      var shortcutDetail = {
        shortcut: btn.dataset.submissionsShortcut,
        submissionId: btn.dataset.submissionId || '',
        submissionMode: btn.dataset.submissionsMode || '',
        sourceView: btn.closest('[data-view]') && btn.closest('[data-view]').dataset
          ? btn.closest('[data-view]').dataset.view || ''
          : '',
      };
      window.dispatchEvent(new CustomEvent('fileeaters:submissions-shortcut', {
        detail: shortcutDetail,
      }));
    }
    if (
      typeof window !== 'undefined' &&
      target === 'submissions' &&
      window.viewSubmissions &&
      typeof window.viewSubmissions.refresh === 'function' &&
      !btn.dataset.submissionsShortcut
    ) {
      window.viewSubmissions.refresh();
    }
  });
}

function applyRoleGuards(roles) {
  var isReviewer = roles.indexOf('reviewer') !== -1 || roles.indexOf('admin') !== -1;
  var isAdmin = roles.indexOf('admin') !== -1;

  document.querySelectorAll('.fe-reviewer-only').forEach(function (el) {
    el.classList.toggle('hidden', !isReviewer);
  });
  document.querySelectorAll('.fe-admin-only').forEach(function (el) { el.classList.add('hidden'); });

  document.querySelectorAll('.fe-admin-only').forEach(function (el) {
    el.classList.toggle('hidden', !isAdmin);
  });
}

function applyUserContext(actor) {
  appState.actor = actor;
  notificationState.actorId = actor.id || 'desktop-local';
  notificationState.actorRole = (actor.roles && actor.roles[0]) || 'creator';

  setText('actor-id', actor.id || '—');
  setText('actor-roles', (actor.roles || []).join(', ') || '—');

  var badge = document.getElementById('sidebar-role-badge');
  if (badge) {
    badge.textContent = ((actor.roles && actor.roles[0]) || 'user').toUpperCase();
  }
  var label = document.getElementById('sidebar-actor-label');
  if (label) {
    label.textContent = actor.id ? actor.id.slice(0, 20) : '';
  }

  applyRoleGuards(actor.roles || []);
  configureNotificationRoleScope(notificationState.actorRole);

  var notifRole = document.getElementById('notifications-role') || document.getElementById('notifications-active-role');
  if (notifRole && actor.roles && actor.roles.length > 0) {
    notifRole.value = actor.roles[0];
  }

  if (
    typeof window !== 'undefined' &&
    window.reviewConsoleStore &&
    typeof window.reviewConsoleStore.setActor === 'function'
  ) {
    window.reviewConsoleStore.setActor(actor);
  }
  if (
    typeof window !== 'undefined' &&
    window.adminPage &&
    typeof window.adminPage.setActor === 'function'
  ) {
    window.adminPage.setActor(actor);
  }
  if (
    !appState.adminViewWired &&
    actor.roles &&
    actor.roles.indexOf('admin') !== -1 &&
    typeof window !== 'undefined' &&
    window.viewAdminOps &&
    typeof window.viewAdminOps.wire === 'function'
  ) {
    appState.adminViewWired = true;
    window.viewAdminOps.wire({ api: api });
  }

  if (api && api.submissions && typeof api.submissions.list === 'function') {
    void refreshQcSubmissionHistoryIndex();
  }

  void maybePromptDropboxSetup(actor);
}

function openProfileMenu() {
  if (typeof document === 'undefined') { return; }
  var trigger = document.getElementById('profile-menu-trigger');
  var panel = document.getElementById('profile-menu-panel');
  if (!trigger || !panel) { return; }
  panel.classList.remove('hidden');
  trigger.setAttribute('aria-expanded', 'true');
  trigger.classList.add('is-open');
  profileMenuState.open = true;
}

function wireProfileMenu() {
  if (
    profileMenuState.wired ||
    typeof document.getElementById !== 'function' ||
    typeof document.addEventListener !== 'function'
  ) {
    return;
  }
  var trigger = document.getElementById('profile-menu-trigger');
  var panel = document.getElementById('profile-menu-panel');
  var logoutButton = document.getElementById('sidebar-signout-btn');
  if (!trigger || !panel) { return; }

  trigger.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (profileMenuState.open) {
      closeProfileMenu();
      return;
    }
    openProfileMenu();
  });

  if (logoutButton) {
    logoutButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      clearAuthenticatedShellContext();
      closeProfileMenu();
      setNavigationEnabled(false);
      navigateTo('auth');
      setActiveTab('login');
    });
  }

  panel.querySelectorAll('[role="menuitem"]').forEach(function (item) {
    if (item === logoutButton) { return; }
    item.addEventListener('click', function () {
      closeProfileMenu();
    });
  });

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (target && typeof target.closest === 'function' && target.closest('.fe-profile-menu')) {
      return;
    }
    closeProfileMenu();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeProfileMenu();
    }
  });

  profileMenuState.wired = true;
}

function ensureDropboxSetupModalInjected() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') { return; }
  if (document.getElementById('dropbox-setup-modal')) { return; }
  var host = document.getElementById('view-mount') || document.body;
  if (!host || typeof host.insertAdjacentHTML !== 'function') { return; }
  host.insertAdjacentHTML('beforeend', [
    '<dialog id="dropbox-setup-modal" class="rounded-brand-sm border border-brand-border bg-brand-bg p-0 shadow-brand-md w-[min(640px,94vw)]">',
    '  <form method="dialog" class="p-5 space-y-3">',
    '    <h3 class="fe-card-title">Connect Dropbox</h3>',
    '    <p id="dropbox-setup-message" class="auth-subtle">Dropbox setup is required for Dropbox uploads.</p>',
    '    <div id="dropbox-setup-app-credentials" class="grid gap-2 sm:grid-cols-2">',
    '      <div><label class="fe-label" for="dropbox-setup-app-key">App Key</label><input id="dropbox-setup-app-key" class="auth-input" type="text" autocomplete="off" /></div>',
    '      <div><label class="fe-label" for="dropbox-setup-app-secret">App Secret</label><input id="dropbox-setup-app-secret" class="auth-input" type="password" autocomplete="off" /></div>',
    '    </div>',
    '    <div class="grid gap-2">',
    '      <button id="dropbox-setup-start" class="auth-button-secondary" type="button">Open Dropbox Login</button>',
    '      <p id="dropbox-setup-url" class="auth-subtle break-all"></p>',
    '      <label class="fe-label" for="dropbox-setup-auth-code">Authorization Code</label>',
    '      <input id="dropbox-setup-auth-code" class="auth-input" type="text" autocomplete="off" placeholder="Paste Dropbox auth code" />',
    '      <button id="dropbox-setup-complete" class="auth-button-secondary" type="button">Complete Connection</button>',
    '    </div>',
    '    <p id="dropbox-setup-feedback" class="auth-subtle"></p>',
    '    <div class="flex justify-end gap-2">',
    '      <button id="dropbox-setup-skip" class="auth-button-secondary" type="button">Skip for now</button>',
    '    </div>',
    '  </form>',
    '</dialog>'
  ].join(''));
}

function setDropboxSetupFeedback(message, isError) {
  var el = document.getElementById('dropbox-setup-feedback');
  if (!el) { return; }
  el.textContent = message || '';
  el.className = isError ? 'auth-feedback error' : 'auth-feedback';
}

function setDropboxSetupMessage(message) {
  var el = document.getElementById('dropbox-setup-message');
  if (el) { el.textContent = message || 'Dropbox setup is required for Dropbox uploads.'; }
}

function setDropboxSetupCredentialInputsVisible(visible) {
  var section = document.getElementById('dropbox-setup-app-credentials');
  if (!section) { return; }
  section.classList.toggle('hidden', !visible);
}

function setDropboxSetupManualCodeVisible(visible) {
  var codeLabel = document.querySelector('label[for="dropbox-setup-auth-code"]');
  var codeInput = document.getElementById('dropbox-setup-auth-code');
  var completeBtn = document.getElementById('dropbox-setup-complete');
  if (codeLabel) { codeLabel.classList.toggle('hidden', !visible); }
  if (codeInput) { codeInput.classList.toggle('hidden', !visible); }
  if (completeBtn) { completeBtn.classList.toggle('hidden', !visible); }
}

function stopDropboxOauthPolling() {
  if (!dropboxSetupState.oauthPollTimer) { return; }
  clearInterval(dropboxSetupState.oauthPollTimer);
  dropboxSetupState.oauthPollTimer = null;
}

function hasDesktopDropboxOauthApi() {
  return Boolean(
    api &&
    api.admin &&
    api.admin.integrations &&
    api.admin.integrations.startDropboxOauthDesktop &&
    api.admin.integrations.getDropboxOauthDesktopStatus
  );
}

async function pollDropboxOauthStatus() {
  if (!dropboxSetupState.oauthSessionId || !hasDesktopDropboxOauthApi()) { return; }
  var actor = appState.actor || { id: '', roles: [] };
  var response = await api.admin.integrations.getDropboxOauthDesktopStatus({
    actorId: actor.id || 'desktop-local-admin',
    actorRole: 'admin',
    sessionId: dropboxSetupState.oauthSessionId,
  });
  if (!response || !response.ok || !response.data) {
    return;
  }
  var status = response.data.status;
  if (status === 'pending') {
    return;
  }
  stopDropboxOauthPolling();
  if (status === 'completed') {
    setDropboxSetupFeedback('Dropbox connected successfully.', false);
    dropboxSetupState.visible = false;
    dropboxSetupState.oauthSessionId = null;
    var modal = document.getElementById('dropbox-setup-modal');
    if (modal && typeof modal.close === 'function') { modal.close(); }
    return;
  }
  dropboxSetupState.oauthSessionId = null;
  setDropboxSetupFeedback(response.data.message || 'Dropbox OAuth did not complete.', true);
}

function startDropboxOauthPolling() {
  stopDropboxOauthPolling();
  dropboxSetupState.oauthPollTimer = setInterval(function () {
    void pollDropboxOauthStatus().catch(function (err) {
      stopDropboxOauthPolling();
      setDropboxSetupFeedback('Dropbox OAuth polling failed: ' + err.message, true);
    });
  }, 1200);
  void pollDropboxOauthStatus().catch(function (err) {
    stopDropboxOauthPolling();
    setDropboxSetupFeedback('Dropbox OAuth polling failed: ' + err.message, true);
  });
}

function wireDropboxSetupModal() {
  if (dropboxSetupState.wired) { return; }
  ensureDropboxSetupModalInjected();
  var modal = document.getElementById('dropbox-setup-modal');
  if (!modal) { return; }

  var startBtn = document.getElementById('dropbox-setup-start');
  var completeBtn = document.getElementById('dropbox-setup-complete');
  var skipBtn = document.getElementById('dropbox-setup-skip');

  if (startBtn) {
    startBtn.addEventListener('click', async function () {
      if (!api || !api.admin || !api.admin.integrations || !api.admin.integrations.startDropboxOauth) {
        setDropboxSetupFeedback('Dropbox integration API is unavailable.', true);
        return;
      }
      var appKey = dropboxSetupState.hasAppCredentials ? '' : getValue('dropbox-setup-app-key');
      var appSecret = dropboxSetupState.hasAppCredentials ? '' : getValue('dropbox-setup-app-secret');
      setButtonBusy(startBtn, true);
      setDropboxSetupFeedback('', false);
      try {
        var actor = appState.actor || { id: '', roles: [] };
        if (hasDesktopDropboxOauthApi()) {
          var desktopResponse = await api.admin.integrations.startDropboxOauthDesktop({
            actorId: actor.id || 'desktop-local-admin',
            actorRole: 'admin',
            appKey: appKey || null,
            appSecret: appSecret || null,
          });
          if (!desktopResponse.ok) {
            setDropboxSetupFeedback(
              desktopResponse.error ? desktopResponse.error.message : 'Failed to start Dropbox login.',
              true
            );
            return;
          }
          var desktopAuthorizeUrl = desktopResponse.data ? desktopResponse.data.authorizeUrl : '';
          setText('dropbox-setup-url', desktopAuthorizeUrl || '');
          dropboxSetupState.oauthSessionId = desktopResponse.data ? desktopResponse.data.sessionId : null;
          setDropboxSetupFeedback('Browser opened. Finish Dropbox login; this dialog will complete automatically.', false);
          startDropboxOauthPolling();
          return;
        }

        var response = await api.admin.integrations.startDropboxOauth({
          actorId: actor.id || 'desktop-local-admin',
          actorRole: 'admin',
          appKey: appKey || null,
        });
        if (!response.ok) {
          setDropboxSetupFeedback(response.error ? response.error.message : 'Failed to start Dropbox login.', true);
          return;
        }
        var authorizeUrl = response.data ? response.data.authorizeUrl : '';
        setText('dropbox-setup-url', authorizeUrl || '');
        if (authorizeUrl && typeof window !== 'undefined' && typeof window.open === 'function') {
          window.open(authorizeUrl, '_blank', 'noopener');
        }
      } catch (err) {
        setDropboxSetupFeedback('Failed to start Dropbox login: ' + err.message, true);
      } finally {
        setButtonBusy(startBtn, false);
      }
    });
  }

  if (completeBtn) {
    completeBtn.addEventListener('click', async function () {
      if (!api || !api.admin || !api.admin.integrations || !api.admin.integrations.completeDropboxOauth) {
        setDropboxSetupFeedback('Dropbox integration API is unavailable.', true);
        return;
      }
      var authCode = getValue('dropbox-setup-auth-code');
      if (!authCode) {
        setDropboxSetupFeedback('Authorization code is required.', true);
        return;
      }
      var appKey = dropboxSetupState.hasAppCredentials ? '' : getValue('dropbox-setup-app-key');
      var appSecret = dropboxSetupState.hasAppCredentials ? '' : getValue('dropbox-setup-app-secret');
      setButtonBusy(completeBtn, true);
      setDropboxSetupFeedback('', false);
      try {
        var actor = appState.actor || { id: '', roles: [] };
        var response = await api.admin.integrations.completeDropboxOauth({
          actorId: actor.id || 'desktop-local-admin',
          actorRole: 'admin',
          authCode: authCode,
          appKey: appKey || null,
          appSecret: appSecret || null,
        });
        if (!response.ok) {
          setDropboxSetupFeedback(response.error ? response.error.message : 'Failed to complete Dropbox connection.', true);
          return;
        }
        setDropboxSetupFeedback('Dropbox connected successfully.', false);
        dropboxSetupState.visible = false;
        if (typeof modal.close === 'function') { modal.close(); }
      } catch (err) {
        setDropboxSetupFeedback('Failed to complete Dropbox connection: ' + err.message, true);
      } finally {
        setButtonBusy(completeBtn, false);
      }
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', function () {
      stopDropboxOauthPolling();
      dropboxSetupState.oauthSessionId = null;
      dropboxSetupState.dismissedForSession = true;
      dropboxSetupState.visible = false;
      if (typeof modal.close === 'function') { modal.close(); }
    });
  }

  modal.addEventListener('close', function () {
    stopDropboxOauthPolling();
  });

  dropboxSetupState.wired = true;
}

function actorIsAdmin(actor) {
  return Boolean(actor && Array.isArray(actor.roles) && actor.roles.indexOf('admin') !== -1);
}

async function maybePromptDropboxSetup(actor) {
  if (!actorIsAdmin(actor)) { return; }
  if (dropboxSetupState.dismissedForSession || dropboxSetupState.visible) { return; }
  if (!api || !api.admin || !api.admin.integrations || !api.admin.integrations.getDropboxReadiness) {
    return;
  }
  try {
    var response = await api.admin.integrations.getDropboxReadiness({
      actorId: actor.id || 'desktop-local-admin',
      actorRole: 'admin',
    });
    if (!response || !response.ok || !response.data) { return; }
    if (response.data.status === 'READY') { return; }
    ensureDropboxSetupModalInjected();
    wireDropboxSetupModal();
    dropboxSetupState.hasAppCredentials = Boolean(response.data.hasAppCredentials);
    setDropboxSetupMessage(response.data.message || 'Dropbox setup is required for Dropbox uploads.');
    setDropboxSetupCredentialInputsVisible(!dropboxSetupState.hasAppCredentials);
    setDropboxSetupManualCodeVisible(!hasDesktopDropboxOauthApi());
    setText('dropbox-setup-url', response.data.authorizeUrl || '');
    var modal = document.getElementById('dropbox-setup-modal');
    if (!modal) { return; }
    dropboxSetupState.visible = true;
    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.setAttribute('open', 'open');
    }
  } catch (_) {
    /* Non-blocking by design */
  }
}

/* ═══════════════════════════════════════════════════════════
   AUTH — TAB SWITCHING
═══════════════════════════════════════════════════════════ */

function setActiveTab(tabName) {
  if (!document || typeof document.querySelectorAll !== 'function') { return; }
  document.querySelectorAll('[data-auth-tab]').forEach(function (el) {
    el.classList.toggle('active', el.dataset.authTab === tabName);
  });
  document.querySelectorAll('[data-auth-view]').forEach(function (el) {
    el.classList.toggle('hidden', el.dataset.authView !== tabName);
  });
}

function wireTabs() {
  if (!document || typeof document.querySelectorAll !== 'function') { return; }
  document.querySelectorAll('[data-auth-tab]').forEach(function (el) {
    el.addEventListener('click', function () { setActiveTab(el.dataset.authTab); });
  });
}

/* ═══════════════════════════════════════════════════════════
   AUTH — FLOWS
═══════════════════════════════════════════════════════════ */

function getActiveActorRole() {
  var roleEl = document.getElementById('notifications-role') || document.getElementById('notifications-active-role');
  if (roleEl) { return roleEl.value; }
  return notificationState.actorRole || 'creator';
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  var submitBtn = event.currentTarget.querySelector('button[type="submit"]');
  setFeedback('login-feedback', '', '');
  var values = { email: getValue('login-email'), password: getValue('login-password') };
  var errors = authUiState.validateLoginForm ? authUiState.validateLoginForm(values) : {};
  if (authUiState.hasValidationErrors && authUiState.hasValidationErrors(errors)) {
    setFeedback('login-feedback', 'warning', errors.email || errors.password || 'Fix errors and try again.');
    return;
  }
  setButtonBusy(submitBtn, true);
  try {
    var response = await api.auth.login({ email: values.email.toLowerCase(), password: values.password, deviceId: 'desktop-local' });
    if (!response.ok) {
      var fb = authUiState.buildAuthMessage ? authUiState.buildAuthMessage(response.error) : { tone: 'error', message: response.error.message };
      setFeedback('login-feedback', fb.tone, fb.message);
      return;
    }
    setFeedback('login-feedback', '', 'Login successful.');
    var el = document.getElementById('login-feedback');
    if (el) { el.textContent = 'Login successful.'; el.className = 'auth-feedback'; }
    if (response.data && response.data.user) {
      applyUserContext({ id: response.data.user.id, roles: response.data.user.roles || [] });
    }
    navigateTo('dashboard');

  } catch (err) {
    setFeedback('login-feedback', 'error', 'Login failed: ' + err.message);
  } finally {
    setButtonBusy(submitBtn, false);
  }
}

async function handleRegisterSendOtp() {
  setFeedback('register-feedback', '', '');
  var email = getValue('register-email');
  var emailErr = authUiState.validateEmail ? authUiState.validateEmail(email) : null;
  if (emailErr) { setFeedback('register-feedback', 'warning', emailErr); return; }
  var btn = document.getElementById('register-send-otp');
  setButtonBusy(btn, true);
  try {
    var r = await api.auth.sendOtp({ target: email.toLowerCase(), purpose: 'register' });
    if (!r.ok) {
      var fb = authUiState.buildAuthMessage ? authUiState.buildAuthMessage(r.error) : { tone: 'error', message: r.error.message };
      setFeedback('register-feedback', fb.tone, fb.message);
      return;
    }
    appState.register.challengeId = r.data.challengeId;
    var msg = authUiState.buildOtpStatusMessage ? authUiState.buildOtpStatusMessage(r.data) : 'OTP sent.';
    setText('register-otp-status', msg || 'OTP sent.');
  } catch (err) {
    setFeedback('register-feedback', 'error', 'OTP request failed: ' + err.message);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleRegisterVerifyOtp() {
  setFeedback('register-feedback', '', '');
  var email = getValue('register-email');
  var otpCode = getValue('register-otp-code');
  var otpErr = authUiState.validateOtpCode ? authUiState.validateOtpCode(otpCode) : null;
  if (otpErr) { setFeedback('register-feedback', 'warning', otpErr); return; }
  var btn = document.getElementById('register-verify-otp');
  setButtonBusy(btn, true);
  try {
    var r = await api.auth.verifyOtp({ challengeId: appState.register.challengeId, otpCode: otpCode, purpose: 'register' });
    if (!r.ok) {
      var fb = authUiState.buildAuthMessage ? authUiState.buildAuthMessage(r.error) : { tone: 'error', message: r.error.message };
      setFeedback('register-feedback', fb.tone, fb.message);
      return;
    }
    appState.register.otpVerificationToken = r.data.otpVerificationToken;
    setText('register-otp-status', 'OTP verified. You may now create your account.');
  } catch (err) {
    setFeedback('register-feedback', 'error', 'OTP verification failed: ' + err.message);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  var submitBtn = event.currentTarget.querySelector('button[type="submit"]');
  setFeedback('register-feedback', '', '');
  var values = {
    email: getValue('register-email'),
    password: getValue('register-password'),
    confirmPassword: getValue('register-confirm-password'),
  };
  var errors = authUiState.validateRegisterForm ? authUiState.validateRegisterForm(values) : {};
  if (authUiState.hasValidationErrors && authUiState.hasValidationErrors(errors)) {
    setFeedback('register-feedback', 'warning', errors.email || errors.password || errors.confirmPassword || 'Fix errors and try again.');
    return;
  }
  if (!appState.register.otpVerificationToken) {
    setFeedback('register-feedback', 'warning', 'Verify your email OTP before registering.');
    return;
  }
  var role = getValue('register-role') || 'creator';
  setButtonBusy(submitBtn, true);
  try {
    var r = await api.auth.register({
      email: values.email.toLowerCase(), password: values.password,
      roles: [role], otpVerificationToken: appState.register.otpVerificationToken,
      deviceId: 'desktop-local'
    });
    if (!r.ok) {
      var fb = authUiState.buildAuthMessage ? authUiState.buildAuthMessage(r.error) : { tone: 'error', message: r.error.message };
      setFeedback('register-feedback', fb.tone, fb.message);
      return;
    }
    setFeedback('register-feedback', '', 'Account created! You can now log in.');
    var el = document.getElementById('register-feedback');
    if (el) { el.textContent = 'Account created! You can now log in.'; el.className = 'auth-feedback'; }
    appState.register.otpVerificationToken = null;
    setTimeout(function () { setActiveTab('login'); }, 1200);
  } catch (err) {
    setFeedback('register-feedback', 'error', 'Registration failed: ' + err.message);
  } finally {
    setButtonBusy(submitBtn, false);
  }
}

async function handleForgotSendOtp() {
  setFeedback('forgot-feedback', '', '');
  var email = getValue('forgot-email');
  var emailErr = authUiState.validateEmail ? authUiState.validateEmail(email) : null;
  if (emailErr) { setFeedback('forgot-feedback', 'warning', emailErr); return; }
  var btn = document.getElementById('forgot-send-otp');
  setButtonBusy(btn, true);
  try {
    var r = await api.auth.forgotPassword({ email: email.toLowerCase() });
    if (!r.ok) {
      var fb = authUiState.buildAuthMessage ? authUiState.buildAuthMessage(r.error) : { tone: 'error', message: r.error.message };
      setFeedback('forgot-feedback', fb.tone, fb.message);
      return;
    }
    appState.forgot.challengeId = r.data.challengeId;
    var msg = authUiState.buildOtpStatusMessage ? authUiState.buildOtpStatusMessage(r.data) : 'OTP sent.';
    setText('forgot-otp-status', msg || 'OTP sent.');
  } catch (err) {
    setFeedback('forgot-feedback', 'error', 'Reset OTP failed: ' + err.message);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleForgotVerifyOtp() {
  setFeedback('forgot-feedback', '', '');
  var email = getValue('forgot-email');
  var otpCode = getValue('forgot-otp-code');
  var otpErr = authUiState.validateOtpCode ? authUiState.validateOtpCode(otpCode) : null;
  if (otpErr) { setFeedback('forgot-feedback', 'warning', otpErr); return; }
  var btn = document.getElementById('forgot-verify-otp');
  setButtonBusy(btn, true);
  try {
    var r = await api.auth.verifyOtp({ challengeId: appState.forgot.challengeId, otpCode: otpCode, purpose: 'forgot-password' });
    if (!r.ok) {
      var fb = authUiState.buildAuthMessage ? authUiState.buildAuthMessage(r.error) : { tone: 'error', message: r.error.message };
      setFeedback('forgot-feedback', fb.tone, fb.message);
      return;
    }
    appState.forgot.otpVerificationToken = r.data.otpVerificationToken;
    setText('forgot-otp-status', 'OTP verified. Enter your new password.');
  } catch (err) {
    setFeedback('forgot-feedback', 'error', 'OTP verification failed: ' + err.message);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleForgotSubmit(event) {
  event.preventDefault();
  var submitBtn = event.currentTarget.querySelector('button[type="submit"]');
  setFeedback('forgot-feedback', '', '');
  var email = getValue('forgot-email');
  var otpCode = getValue('forgot-otp-code');
  var newPassword = getValue('reset-password');
  var confirmPassword = getValue('reset-confirm-password');
  var values = { email, otpCode, newPassword, confirmPassword };
  var errors = authUiState.validateResetForm ? authUiState.validateResetForm(values) : {};
  if (authUiState.hasValidationErrors && authUiState.hasValidationErrors(errors)) {
    setFeedback('forgot-feedback', 'warning', errors.email || errors.otpCode || errors.newPassword || errors.confirmPassword || 'Fix errors and try again.');
    return;
  }
  if (!appState.forgot.otpVerificationToken) {
    setFeedback('forgot-feedback', 'warning', 'Verify your OTP before resetting password.');
    return;
  }
  setButtonBusy(submitBtn, true);
  try {
    var r = await api.auth.resetPassword({
      email: email.toLowerCase(), newPassword,
      otpVerificationToken: appState.forgot.otpVerificationToken,
    });
    if (!r.ok) {
      var fb = authUiState.buildAuthMessage ? authUiState.buildAuthMessage(r.error) : { tone: 'error', message: r.error.message };
      setFeedback('forgot-feedback', fb.tone, fb.message);
      return;
    }
    appState.forgot.otpVerificationToken = null;
    var el = document.getElementById('forgot-feedback');
    if (el) { el.textContent = 'Password reset complete. ' + r.data.revokedSessionCount + ' sessions revoked.'; el.className = 'auth-feedback'; }
  } catch (err) {
    setFeedback('forgot-feedback', 'error', 'Password reset failed: ' + err.message);
  } finally {
    setButtonBusy(submitBtn, false);
  }
}

function wireRoleMenu() {
  var menuBtn = document.getElementById('register-role-button');
  var menu = document.getElementById('register-role-menu');
  var roleInput = document.getElementById('register-role');
  var roleLabel = document.getElementById('register-role-label');
  if (!menuBtn || !menu) { return; }

  menuBtn.addEventListener('click', function () {
    var isOpen = !menu.classList.contains('hidden');
    menu.classList.toggle('hidden', isOpen);
    menuBtn.setAttribute('aria-expanded', String(!isOpen));
  });

  menu.querySelectorAll('[data-role-value]').forEach(function (opt) {
    opt.addEventListener('click', function () {
      var val = opt.dataset.roleValue;
      if (roleInput) { roleInput.value = val; }
      if (roleLabel) { roleLabel.textContent = opt.textContent; }
      menu.querySelectorAll('.auth-role-option').forEach(function (o) { o.classList.remove('active'); });
      opt.classList.add('active');
      menu.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
    });
  });
}

function wireLoginPasswordToggle() {
  var passwordInput = document.getElementById('login-password');
  var toggleBtn = document.getElementById('login-toggle-password');
  var iconEl = document.getElementById('login-toggle-password-icon');
  if (!passwordInput || !toggleBtn || !iconEl) { return; }
  var eyeIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4 fill-current text-brand-text-strong"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
  var eyeOffIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4 fill-current text-brand-text-strong"><path d="m2 4.27 2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zM12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16c.57-.23 1.18-.36 1.83-.36z"/></svg>';

  function setToggleVisualState(visible) {
    toggleBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    iconEl.innerHTML = visible ? eyeOffIconSvg : eyeIconSvg;
  }

  setToggleVisualState(false);

  toggleBtn.addEventListener('click', function () {
    var showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    setToggleVisualState(!showing);
    try {
      if (typeof passwordInput.focus === 'function') { passwordInput.focus(); }
      if (typeof passwordInput.selectionStart === 'number' && typeof passwordInput.selectionEnd === 'number') {
        var cursor = passwordInput.value.length;
        passwordInput.setSelectionRange(cursor, cursor);
      }
    } catch (_error) {
      // Cursor management is best-effort only.
    }
  });
}

function wireAuthFlows() {
  var loginForm = document.getElementById('login-form');
  if (loginForm) { loginForm.addEventListener('submit', handleLoginSubmit); }

  var regSendOtp = document.getElementById('register-send-otp');
  if (regSendOtp) { regSendOtp.addEventListener('click', handleRegisterSendOtp); }

  var regVerifyOtp = document.getElementById('register-verify-otp');
  if (regVerifyOtp) { regVerifyOtp.addEventListener('click', handleRegisterVerifyOtp); }

  var regForm = document.getElementById('register-form');
  if (regForm) { regForm.addEventListener('submit', handleRegisterSubmit); }

  var forgotSendOtp = document.getElementById('forgot-send-otp');
  if (forgotSendOtp) { forgotSendOtp.addEventListener('click', handleForgotSendOtp); }

  var forgotVerifyOtp = document.getElementById('forgot-verify-otp');
  if (forgotVerifyOtp) { forgotVerifyOtp.addEventListener('click', handleForgotVerifyOtp); }

  var forgotForm = document.getElementById('forgot-form');
  if (forgotForm) { forgotForm.addEventListener('submit', handleForgotSubmit); }

  wireRoleMenu();
  wireLoginPasswordToggle();
}

/* ═══════════════════════════════════════════════════════════
   QC ADMIN FLOWS
═══════════════════════════════════════════════════════════ */

function buildQcEvaluationPayload() {
  var folders = getValue('qc-folders').split(',').map(function (f) { return f.trim(); }).filter(Boolean);
  var submissionId = getValue('qc-submission-id') || qcState.activeSubmissionId || 'sub-local-1';
  var requestId = 'qc-' + Date.now();
  return {
    requestId: requestId,
    submissionId: submissionId,
    actorId: appState.actor.id || notificationState.actorId || 'desktop-local',
    actorRole: getActiveActorRole(),
    pack: {
      packName: getValue('qc-pack-name') || 'Label - Pack',
      declaredTopLevelFolders: folders.length > 0 ? folders : ['Artwork', 'Audio', 'Description'],
      audioZip: {
        filename: getValue('qc-audio-zip-name') || 'Label - Pack.zip',
        sizeBytes: parseInt(getValue('qc-audio-zip-size'), 10) || 0,
      },
      sampleCount: parseInt(getValue('qc-sample-count'), 10) || 0,
      containsUnsupportedNameTokens: getChecked('qc-unsupported-tokens'),
    },
  };
}

function getQcCatalogApi() {
  if (qcGuidanceCatalog && typeof qcGuidanceCatalog.resolveGuidance === 'function') {
    return qcGuidanceCatalog;
  }
  return {
    CATEGORY_ORDER: ['folder', 'audio-zip', 'samples', 'demo', 'description', 'artwork', 'presets', 'midi'],
    CATEGORY_LABELS: {
      'folder': 'Folder',
      'audio-zip': 'Audio ZIP',
      'samples': 'Samples',
      'demo': 'Demo',
      'description': 'Description',
      'artwork': 'Artwork',
      'presets': 'Presets',
      'midi': 'MIDI',
    },
    resolveGuidance: function (ruleId) {
      var normalized = String(ruleId || '').toUpperCase();
      return {
        title: normalized || 'Unknown QC Rule',
        description: 'This QC finding requires review.',
        remediation: 'Review this finding and rerun QC.',
        category: inferQcCategoryFromRuleId(normalized),
      };
    },
    formatTemplate: function (template) {
      return String(template || '');
    },
  };
}

function inferQcCategoryFromRuleId(ruleId) {
  var value = String(ruleId || '').toUpperCase();
  if (value.indexOf('AUDIO_ZIP') !== -1 || value.indexOf('PACK.AUDIO.ZIP') === 0) { return 'audio-zip'; }
  if (value.indexOf('SAMPLE') !== -1 || value.indexOf('PACK.SAMPLE') === 0 || value.indexOf('PACK.NAMING') === 0) { return 'samples'; }
  if (value.indexOf('DEMO') !== -1) { return 'demo'; }
  if (value.indexOf('DESCRIPTION') !== -1) { return 'description'; }
  if (value.indexOf('ART') !== -1 || value.indexOf('ARTWORK') !== -1) { return 'artwork'; }
  if (value.indexOf('PRESET') !== -1) { return 'presets'; }
  if (value.indexOf('MIDI') !== -1) { return 'midi'; }
  return 'folder';
}

function formatQcSize(bytes) {
  if (!Number.isFinite(bytes)) { return '—'; }
  if (bytes >= 1024 * 1024 * 1024) { return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'; }
  if (bytes >= 1024 * 1024) { return (bytes / (1024 * 1024)).toFixed(2) + ' MB'; }
  if (bytes >= 1024) { return (bytes / 1024).toFixed(2) + ' KB'; }
  return String(bytes) + ' B';
}

function extractFindingFileRef(finding) {
  if (finding.fileRef) { return finding.fileRef; }
  var context = finding.context || {};
  return (
    context.file_ref ||
    context.fileRef ||
    context.path ||
    context.file ||
    context.relative_path ||
    context.audio_zip_filename ||
    context.filename ||
    null
  );
}

function hydrateFinding(finding) {
  var catalog = getQcCatalogApi();
  var ruleId = finding.ruleId || finding.rule_id || 'UNKNOWN_RULE';
  var guidance = catalog.resolveGuidance(ruleId);
  var context = finding.context || {};
  var fileRef = extractFindingFileRef(finding);
  var formattedRemediation = guidance.remediation || finding.remediation || 'Fix this issue and rerun QC.';
  if (typeof catalog.formatTemplate === 'function') {
    formattedRemediation = catalog.formatTemplate(formattedRemediation, {
      size: formatQcSize(context.audio_zip_size_bytes || context.size_bytes || context.size),
      count: context.sample_count || context.count || '—',
      file_ref: fileRef || '—',
    });
  }
  return {
    findingId: finding.findingId || finding.finding_id || (ruleId + ':' + (fileRef || 'unknown')),
    ruleId: ruleId,
    severity: finding.blocking || finding.severity === 'blocking' ? 'blocking' : 'warning',
    category: finding.category || guidance.category || inferQcCategoryFromRuleId(ruleId),
    fileRef: fileRef,
    message: finding.message || guidance.description || 'QC issue found.',
    remediation: formattedRemediation,
    diffTag: finding.diffTag || finding.diff_tag || null,
  };
}

function mapResultsData(data, fallbackRunId, fallbackStatus, fallbackStartedAt, fallbackCompletedAt, fallbackFindings) {
  var findings = Array.isArray(data && data.findings) ? data.findings.map(hydrateFinding) : fallbackFindings.map(hydrateFinding);
  return {
    runId: (data && data.runId) || fallbackRunId,
    status: (data && data.status) || fallbackStatus || 'failed',
    startedAt: (data && data.startedAt) || fallbackStartedAt || new Date().toISOString(),
    completedAt: (data && data.completedAt) || fallbackCompletedAt || new Date().toISOString(),
    findings: findings,
    resolvedFindings: [],
    resolvedCount: 0,
  };
}

function findingFingerprint(finding) {
  return [
    (finding.ruleId || '').toLowerCase(),
    (finding.fileRef || '').toLowerCase(),
    (finding.message || '').toLowerCase(),
  ].join('|');
}

function applyFindingDiff(currentRun, previousRun) {
  var prevMap = {};
  var currentMap = {};
  (previousRun && previousRun.findings ? previousRun.findings : []).forEach(function (finding) {
    prevMap[findingFingerprint(finding)] = finding;
  });
  (currentRun.findings || []).forEach(function (finding) {
    currentMap[findingFingerprint(finding)] = finding;
  });

  currentRun.findings = (currentRun.findings || []).map(function (finding) {
    var key = findingFingerprint(finding);
    return Object.assign({}, finding, {
      diffTag: prevMap[key] ? 'unchanged' : 'new',
    });
  });

  currentRun.resolvedFindings = Object.keys(prevMap)
    .filter(function (key) { return !currentMap[key]; })
    .map(function (key) {
      return Object.assign({}, prevMap[key], { diffTag: 'resolved' });
    });
  currentRun.resolvedCount = currentRun.resolvedFindings.length;
  return currentRun;
}

function compareFindingOrder(a, b) {
  if (a.severity !== b.severity) {
    return a.severity === 'blocking' ? -1 : 1;
  }
  if (a.ruleId !== b.ruleId) {
    return String(a.ruleId).localeCompare(String(b.ruleId));
  }
  return String(a.fileRef || '').localeCompare(String(b.fileRef || ''));
}

function toDisplayDateTime(value) {
  if (!value) {
    return 'unknown time';
  }
  var dt = new Date(value);
  if (isNaN(dt.getTime())) {
    return 'unknown time';
  }
  return dt.toLocaleString();
}

function isQcBackendUnreachable(errorLike) {
  if (!errorLike) {
    return false;
  }
  var reason = String(errorLike.reason || '').toUpperCase();
  var message = String(errorLike.message || '').toLowerCase();
  return (
    reason.indexOf('BACKEND_UNREACHABLE') !== -1 ||
    message.indexOf('backend is unavailable') !== -1 ||
    message.indexOf('failed to fetch') !== -1 ||
    message.indexOf('network') !== -1
  );
}

function setQcHydrationState(submissionId, status, message) {
  qcState.hydrationStateBySubmissionId[submissionId] = {
    status: status,
    message: message || '',
  };
}

function getQcHydrationState(submissionId) {
  return qcState.hydrationStateBySubmissionId[submissionId] || { status: 'idle', message: '' };
}

function buildSubmissionOptionLabel(submission) {
  var prefix = submission.packName ? submission.packName + ' (' : '';
  var suffix = submission.packName ? ')' : '';
  return prefix + submission.submissionId + suffix;
}

function ensureKnownQcSubmission(submissionId, label, updatedAt) {
  var normalizedId = String(submissionId || '').trim();
  if (!normalizedId) {
    return;
  }
  var existing = qcState.knownSubmissions.find(function (item) {
    return item.submissionId === normalizedId;
  });
  if (existing) {
    if (label) {
      existing.label = label;
    }
    if (updatedAt) {
      existing.updatedAt = updatedAt;
    }
    return;
  }
  qcState.knownSubmissions.push({
    submissionId: normalizedId,
    label: label || normalizedId,
    updatedAt: updatedAt || '',
  });
}

function collectKnownQcSubmissions() {
  var indexed = {};
  qcState.knownSubmissions.forEach(function (item) {
    if (!item || !item.submissionId) {
      return;
    }
    indexed[item.submissionId] = {
      submissionId: item.submissionId,
      label: item.label || item.submissionId,
      updatedAt: item.updatedAt || '',
    };
  });
  Object.keys(qcState.runsBySubmissionId).forEach(function (submissionId) {
    if (!indexed[submissionId]) {
      indexed[submissionId] = {
        submissionId: submissionId,
        label: submissionId,
        updatedAt: '',
      };
    }
  });
  var typedSubmissionId = getValue('qc-submission-id');
  if (typedSubmissionId && !indexed[typedSubmissionId]) {
    indexed[typedSubmissionId] = {
      submissionId: typedSubmissionId,
      label: typedSubmissionId,
      updatedAt: '',
    };
  }
  if (qcState.activeSubmissionId && !indexed[qcState.activeSubmissionId]) {
    indexed[qcState.activeSubmissionId] = {
      submissionId: qcState.activeSubmissionId,
      label: qcState.activeSubmissionId,
      updatedAt: '',
    };
  }
  return Object.keys(indexed)
    .map(function (key) { return indexed[key]; })
    .sort(function (a, b) {
      var aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      var bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return String(a.submissionId).localeCompare(String(b.submissionId));
    });
}

function renderQcSubmissionSelector() {
  var selector = document.getElementById('qc-report-submission-selector');
  if (!selector) {
    return;
  }
  var options = collectKnownQcSubmissions();
  qcState.knownSubmissions = options;
  if (options.length === 0) {
    selector.disabled = true;
    selector.innerHTML = '<option value="">No submissions found</option>';
    selector.value = '';
    return;
  }
  selector.disabled = false;
  selector.innerHTML = options
    .map(function (item) {
      return '<option value="' + escapeHtml(item.submissionId) + '">' + escapeHtml(item.label) + '</option>';
    })
    .join('');
  if (!qcState.activeSubmissionId || !options.some(function (item) { return item.submissionId === qcState.activeSubmissionId; })) {
    qcState.activeSubmissionId = options[0].submissionId;
  }
  selector.value = qcState.activeSubmissionId;
  setValue('qc-submission-id', qcState.activeSubmissionId);
}

function formatQcRunSelectorLabel(run) {
  var status = String(run.status || 'not_run').toUpperCase();
  var startedAt = toDisplayDateTime(run.startedAt || run.completedAt);
  return run.runId + ' (' + status + ', ' + startedAt + ')';
}

function renderQcRunSelector() {
  var selector = document.getElementById('qc-report-run-selector');
  if (!selector) {
    return;
  }
  var bucket = qcState.runsBySubmissionId[qcState.activeSubmissionId];
  var history = bucket && Array.isArray(bucket.history) ? bucket.history.slice() : [];
  history.sort(function (a, b) {
    var aTime = a.completedAt ? Date.parse(a.completedAt) : 0;
    var bTime = b.completedAt ? Date.parse(b.completedAt) : 0;
    return bTime - aTime;
  });

  if (history.length === 0) {
    selector.disabled = true;
    selector.innerHTML = '<option value="">No runs</option>';
    selector.value = '';
    delete qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId];
    return;
  }

  selector.disabled = false;
  selector.innerHTML = history
    .map(function (run) {
      return '<option value="' + escapeHtml(run.runId) + '">' + escapeHtml(formatQcRunSelectorLabel(run)) + '</option>';
    })
    .join('');

  var activeRunId = qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId];
  var activeRunExists = activeRunId && history.some(function (run) { return run.runId === activeRunId; });
  if (!activeRunExists) {
    activeRunId = history[0].runId;
    qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId] = activeRunId;
  }
  selector.value = activeRunId;
}

function getActiveQcRun() {
  var bucket = qcState.runsBySubmissionId[qcState.activeSubmissionId];
  if (!bucket || !Array.isArray(bucket.history) || bucket.history.length === 0) {
    return null;
  }
  var activeRunId = qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId];
  if (activeRunId) {
    var selected = bucket.history.find(function (run) { return run.runId === activeRunId; });
    if (selected) {
      return selected;
    }
  }
  return bucket.latest || bucket.history[bucket.history.length - 1] || null;
}

function setQcReportFeedback(tone, message) {
  setFeedback('qc-report-feedback', tone, message);
}

function renderQcResultsTable(container, findings) {
  var catalog = getQcCatalogApi();
  var categoryOrder = catalog.CATEGORY_ORDER || ['folder', 'audio-zip', 'samples', 'demo', 'description', 'artwork', 'presets', 'midi'];
  var labels = catalog.CATEGORY_LABELS || {};
  var severityFilter = qcState.severityFilter;
  var categoryFilter = qcState.categoryFilter;

  var filtered = findings
    .filter(function (finding) {
      return severityFilter === 'all' ? true : finding.severity === severityFilter;
    })
    .filter(function (finding) {
      return categoryFilter === 'all' ? true : finding.category === categoryFilter;
    })
    .sort(compareFindingOrder);

  if (filtered.length === 0) {
    container.innerHTML = '<p class=\"auth-subtle\">No findings match the active filters.</p>';
    return;
  }

  var groups = {};
  categoryOrder.forEach(function (category) { groups[category] = []; });
  filtered.forEach(function (finding) {
    var key = groups[finding.category] ? finding.category : inferQcCategoryFromRuleId(finding.ruleId);
    if (!groups[key]) { groups[key] = []; }
    groups[key].push(finding);
  });

  var html = '';
  categoryOrder.forEach(function (category) {
    var rows = groups[category] || [];
    if (rows.length === 0) { return; }
    html += '<section class=\"space-y-2\">';
    html += '<h4 class=\"fe-section-heading\">' + escapeHtml(labels[category] || category) + '</h4>';
    html += '<div class=\"fe-table-wrap\"><table class=\"fe-table\"><thead><tr>';
    html += '<th class=\"fe-th\">Severity</th><th class=\"fe-th\">Status</th><th class=\"fe-th\">Rule</th><th class=\"fe-th\">File</th><th class=\"fe-th\">Message</th><th class=\"fe-th\">Remediation</th>';
    html += '</tr></thead><tbody>';
    rows.forEach(function (finding) {
      var severityClass = finding.severity === 'blocking'
        ? 'border-brand-danger bg-red-50 text-brand-danger'
        : 'border-amber-500 bg-amber-50 text-amber-800';
      var statusClass = finding.diffTag === 'new'
        ? 'border-blue-500 bg-blue-50 text-blue-800'
        : finding.diffTag === 'resolved'
          ? 'border-gray-500 bg-gray-100 text-gray-700'
          : 'border-brand-border bg-brand-surface-alt text-brand-text';
      html += '<tr>';
      html += '<td class=\"fe-td\"><span class=\"inline-flex rounded-brand-pill border px-3 py-1 text-xs font-semibold uppercase ' + severityClass + '\">' + escapeHtml(finding.severity) + '</span></td>';
      html += '<td class=\"fe-td\"><span class=\"inline-flex rounded-brand-pill border px-3 py-1 text-xs font-semibold uppercase ' + statusClass + '\">' + escapeHtml((finding.diffTag || 'unchanged').toUpperCase()) + '</span></td>';
      html += '<td class=\"fe-td font-mono text-xs\">' + escapeHtml(finding.ruleId) + '</td>';
      html += '<td class=\"fe-td font-mono text-xs\">' + escapeHtml(finding.fileRef || '—') + '</td>';
      html += '<td class=\"fe-td\">' + escapeHtml(finding.message) + '</td>';
      html += '<td class=\"fe-td\">' + escapeHtml(finding.remediation) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div></section>';
  });
  container.innerHTML = html;
}

function renderQcReportView() {
  renderQcSubmissionSelector();
  renderQcRunSelector();

  var run = getActiveQcRun();
  var summaryText = document.getElementById('qc-results-summary');
  var blockingCount = document.getElementById('qc-report-blocking-count');
  var warningCount = document.getElementById('qc-report-warning-count');
  var passFailBadge = document.getElementById('qc-report-pass-fail');
  var resolvedSummary = document.getElementById('qc-report-resolved-summary');
  var findingsContainer = document.getElementById('qc-results-findings');
  var hydrationState = getQcHydrationState(qcState.activeSubmissionId);

  if (!run) {
    if (summaryText) {
      if (hydrationState.status === 'unreachable') {
        summaryText.textContent = 'QC history unavailable because the backend is unreachable. Next step: start the backend service, then refresh this report.';
      } else if (hydrationState.status === 'empty') {
        summaryText.textContent = 'No QC runs found for this submission.';
      } else {
        summaryText.textContent = 'Run QC to load report details.';
      }
    }
    if (blockingCount) { blockingCount.textContent = '0'; }
    if (warningCount) { warningCount.textContent = '0'; }
    if (passFailBadge) {
      passFailBadge.textContent = 'NOT RUN';
      passFailBadge.className = 'inline-flex items-center rounded-brand-pill border border-brand-border bg-brand-surface-alt px-3 py-1 text-xs font-semibold text-brand-text';
    }
    if (resolvedSummary) { resolvedSummary.textContent = hydrationState.status === 'empty' ? 'No previous run to compare for this submission.' : 'No previous run to compare.'; }
    if (findingsContainer) {
      if (hydrationState.status === 'unreachable') {
        findingsContainer.innerHTML = '<p class=\"auth-subtle\">Backend is unreachable. Start the API service and retry.</p>';
        setQcReportFeedback('error', hydrationState.message || 'QC backend is unreachable. Next step: start the backend service and retry.');
      } else if (hydrationState.status === 'empty') {
        findingsContainer.innerHTML = '<p class=\"auth-subtle\">No findings yet for this submission.</p>';
        setQcReportFeedback('', '');
      } else {
        findingsContainer.innerHTML = '<p class=\"auth-subtle\">Run a QC check from Upload & QC to see findings here.</p>';
        setQcReportFeedback('', '');
      }
    }
    return;
  }
  setQcReportFeedback('', '');

  var blockingFindings = run.findings.filter(function (finding) { return finding.severity === 'blocking'; });
  var warningFindings = run.findings.filter(function (finding) { return finding.severity === 'warning'; });
  var statusLabel = run.status === 'passed' ? 'PASS' : 'FAIL';
  var summary = 'Run ' + run.runId + ' — ' + statusLabel + ' (' + blockingFindings.length + ' blocking, ' + warningFindings.length + ' warning).';
  if (summaryText) { summaryText.textContent = summary; }
  if (blockingCount) { blockingCount.textContent = String(blockingFindings.length); }
  if (warningCount) { warningCount.textContent = String(warningFindings.length); }
  if (passFailBadge) {
    passFailBadge.textContent = statusLabel;
    passFailBadge.className = run.status === 'passed'
      ? 'inline-flex items-center rounded-brand-pill border border-green-700 bg-green-50 px-3 py-1 text-xs font-semibold text-green-800'
      : 'inline-flex items-center rounded-brand-pill border border-brand-danger bg-red-50 px-3 py-1 text-xs font-semibold text-brand-danger';
  }
  if (resolvedSummary) {
    resolvedSummary.textContent = run.resolvedCount > 0
      ? run.resolvedCount + ' issues resolved since last run.'
      : 'No issues resolved since last run.';
  }

  var displayFindings = run.findings.concat(run.resolvedFindings || []);
  if (findingsContainer) {
    renderQcResultsTable(findingsContainer, displayFindings);
  }
}

function persistQcRun(submissionId, runRecord) {
  var bucket = qcState.runsBySubmissionId[submissionId];
  if (!bucket) {
    bucket = { history: [], latest: null };
    qcState.runsBySubmissionId[submissionId] = bucket;
  }

  var existingIndex = bucket.history.findIndex(function (entry) {
    return entry.runId === runRecord.runId;
  });
  if (existingIndex === -1) {
    bucket.history.push(runRecord);
  } else {
    bucket.history[existingIndex] = runRecord;
  }
  bucket.latest = runRecord;
  qcState.activeSubmissionId = submissionId;
  qcState.activeRunIdBySubmissionId[submissionId] = runRecord.runId;
  setQcHydrationState(submissionId, 'ready', '');
  ensureKnownQcSubmission(submissionId, null, runRecord.completedAt || runRecord.startedAt || '');
}

function hydrateQcHistoryFromBackend(submissionId) {
  if (!api || !api.qc || !api.qc.getResults) {
    setQcHydrationState(submissionId, 'unreachable', 'QC API not available.');
    return Promise.resolve(false);
  }

  return api.qc.getResults({ submissionId: submissionId })
    .then(function (resultsResponse) {
      if (!resultsResponse || !resultsResponse.ok) {
        var errorPayload = resultsResponse && resultsResponse.error ? resultsResponse.error : {};
        if (isQcBackendUnreachable(errorPayload)) {
          setQcHydrationState(submissionId, 'unreachable', 'QC backend is unreachable. Next step: start the backend service and retry.');
        } else {
          var failureMessage = errorPayload.message || 'Failed to load QC history.';
          setQcHydrationState(submissionId, 'error', failureMessage);
        }
        return false;
      }

      var historyPayload = Array.isArray(resultsResponse.data.history) ? resultsResponse.data.history.slice() : [];
      var latestPayload = resultsResponse.data || {};
      if (
        historyPayload.length === 0 &&
        latestPayload.runId &&
        latestPayload.status &&
        latestPayload.status !== 'not_run'
      ) {
        historyPayload = [latestPayload];
      }

      if (historyPayload.length === 0) {
        qcState.runsBySubmissionId[submissionId] = { history: [], latest: null };
        delete qcState.activeRunIdBySubmissionId[submissionId];
        setQcHydrationState(submissionId, 'empty', 'No QC runs found for this submission.');
        ensureKnownQcSubmission(submissionId, null, '');
        return true;
      }

      var builtHistory = [];
      historyPayload.forEach(function (runPayload, index) {
        var fallbackRunId = runPayload.runId || ('qc-history-run-' + index);
        var fallbackStatus = runPayload.status || 'not_run';
        var fallbackStartedAt = runPayload.startedAt || null;
        var fallbackCompletedAt = runPayload.completedAt || null;
        var fallbackFindings = Array.isArray(runPayload.findings) ? runPayload.findings : [];
        var previous = builtHistory.length > 0 ? builtHistory[builtHistory.length - 1] : null;
        var mapped = mapResultsData(
          runPayload,
          fallbackRunId,
          fallbackStatus,
          fallbackStartedAt,
          fallbackCompletedAt,
          fallbackFindings
        );
        builtHistory.push(applyFindingDiff(mapped, previous));
      });

      qcState.runsBySubmissionId[submissionId] = {
        history: builtHistory,
        latest: builtHistory.length > 0 ? builtHistory[builtHistory.length - 1] : null,
      };
      var previousActiveRunId = qcState.activeRunIdBySubmissionId[submissionId];
      var previousExists = previousActiveRunId && builtHistory.some(function (run) { return run.runId === previousActiveRunId; });
      qcState.activeRunIdBySubmissionId[submissionId] = previousExists
        ? previousActiveRunId
        : builtHistory[builtHistory.length - 1].runId;
      setQcHydrationState(submissionId, 'ready', '');
      var latestRun = builtHistory[builtHistory.length - 1];
      ensureKnownQcSubmission(submissionId, null, latestRun.completedAt || latestRun.startedAt || '');
      return true;
    })
    .catch(function (error) {
      if (isQcBackendUnreachable(error)) {
        setQcHydrationState(submissionId, 'unreachable', 'QC backend is unreachable. Next step: start the backend service and retry.');
      } else {
        setQcHydrationState(submissionId, 'error', 'Failed to load QC history.');
      }
      return false;
    });
}

function refreshQcSubmissionHistoryIndex() {
  if (!api || !api.submissions || !api.submissions.list) {
    renderQcReportView();
    return Promise.resolve(false);
  }
  var actorId = appState.actor.id || notificationState.actorId || 'desktop-local';
  return api.submissions.list({ creatorId: actorId, actorId: actorId })
    .then(function (response) {
      if (!response || !response.ok) {
        var errorPayload = response && response.error ? response.error : {};
        if (isQcBackendUnreachable(errorPayload)) {
          setQcHydrationState(qcState.activeSubmissionId, 'unreachable', 'QC backend is unreachable. Next step: start the backend service and retry.');
        } else {
          setQcHydrationState(qcState.activeSubmissionId, 'error', errorPayload.message || 'Failed to load submissions for QC history.');
        }
        renderQcReportView();
        return false;
      }
      var items = Array.isArray(response.data.submissions) ? response.data.submissions : [];
      items.forEach(function (submission) {
        ensureKnownQcSubmission(
          submission.submissionId,
          buildSubmissionOptionLabel(submission),
          submission.updatedAt || ''
        );
      });
      renderQcSubmissionSelector();
      return hydrateQcHistoryFromBackend(qcState.activeSubmissionId).then(function () {
        renderQcReportView();
        return true;
      });
    })
    .catch(function () {
      setQcHydrationState(qcState.activeSubmissionId, 'unreachable', 'QC backend is unreachable. Next step: start the backend service and retry.');
      renderQcReportView();
      return false;
    });
}

function setActiveQcSubmission(submissionId) {
  var nextSubmissionId = String(submissionId || '').trim();
  if (!nextSubmissionId) {
    return Promise.resolve(false);
  }
  qcState.activeSubmissionId = nextSubmissionId;
  ensureKnownQcSubmission(nextSubmissionId, null, '');
  setValue('qc-submission-id', nextSubmissionId);
  renderQcSubmissionSelector();
  return hydrateQcHistoryFromBackend(nextSubmissionId).then(function () {
    renderQcReportView();
    return true;
  });
}

async function handleQcRun() {
  if (!api || !api.qc || !api.qc.evaluatePack) {
    setFeedback('qc-feedback', 'warning', 'QC API not available.');
    setQcReportFeedback('warning', 'QC API not available.');
    return;
  }

  setFeedback('qc-feedback', '', '');
  setQcReportFeedback('', '');
  var runButton = document.getElementById('qc-run-button');
  var rerunButton = document.getElementById('qc-report-rerun-button');
  setButtonBusy(runButton, true);
  setButtonBusy(rerunButton, true);

  try {
    var payload = buildQcEvaluationPayload();
    var startedAt = new Date().toISOString();
    var previousBucket = qcState.runsBySubmissionId[payload.submissionId];
    var previousRun = previousBucket ? previousBucket.latest : null;

    var evaluationResponse = await api.qc.evaluatePack(payload);
    if (!evaluationResponse.ok) {
      var msg = evaluationResponse.error && evaluationResponse.error.message ? evaluationResponse.error.message : 'QC evaluation failed.';
      setFeedback('qc-feedback', 'error', msg);
      setQcReportFeedback('error', msg);
      return;
    }

    var report = evaluationResponse.data.report || {};
    var mappedFromEvaluate = mapResultsData(
      null,
      payload.requestId,
      report.status || 'failed',
      startedAt,
      report.generatedAt || new Date().toISOString(),
      report.findings || []
    );

    var hydrated = await setActiveQcSubmission(payload.submissionId);
    var runRecord = hydrated ? getActiveQcRun() : null;
    if (!runRecord) {
      runRecord = applyFindingDiff(mappedFromEvaluate, previousRun);
      persistQcRun(payload.submissionId, runRecord);
    }

    var summary = runRecord.status === 'passed'
      ? 'QC PASSED — no blocking findings.'
      : 'QC FAILED — ' + runRecord.findings.filter(function (finding) { return finding.severity === 'blocking'; }).length + ' blocking finding(s).';
    setText('qc-report-summary', summary);
    setFeedback('qc-feedback', runRecord.status === 'passed' ? '' : 'error', runRecord.status === 'passed' ? '' : summary);
    var out = document.getElementById('qc-rules-output');
    if (out) {
      out.textContent = toPrettyJson({
        runId: runRecord.runId,
        submissionId: payload.submissionId,
        status: runRecord.status,
        startedAt: runRecord.startedAt,
        completedAt: runRecord.completedAt,
        findings: runRecord.findings,
        resolvedFindings: runRecord.resolvedFindings,
      });
    }
    renderQcReportView();
  } catch (err) {
    var message = 'QC failed: ' + err.message;
    setFeedback('qc-feedback', 'error', message);
    setQcReportFeedback('error', message);
  } finally {
    setButtonBusy(runButton, false);
    setButtonBusy(rerunButton, false);
  }
}

async function handleQcExportReport() {
  if (!api || !api.qc || !api.qc.exportReport) {
    setQcReportFeedback('warning', 'Export API not available.');
    return;
  }

  var run = getActiveQcRun();
  if (!run || !run.runId) {
    setQcReportFeedback('warning', 'Run QC before exporting findings.');
    return;
  }

  var exportButton = document.getElementById('qc-report-export-button');
  setButtonBusy(exportButton, true);
  setQcReportFeedback('', '');
  try {
    var response = await api.qc.exportReport({
      submissionId: qcState.activeSubmissionId,
      runId: run.runId,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      findings: run.findings.concat(run.resolvedFindings || []).map(function (finding) {
        return {
          findingId: finding.findingId,
          ruleId: finding.ruleId,
          severity: finding.severity,
          category: finding.category,
          fileRef: finding.fileRef || null,
          message: finding.message,
          remediation: finding.remediation,
          diffTag: finding.diffTag || 'unchanged',
        };
      }),
    });

    if (!response.ok) {
      setQcReportFeedback('error', response.error && response.error.message ? response.error.message : 'Export failed.');
      return;
    }
    if (response.data.canceled) {
      setQcReportFeedback('warning', 'Export canceled.');
      return;
    }
    setQcReportFeedback('', 'Findings exported to ' + response.data.path);
  } catch (err) {
    setQcReportFeedback('error', 'Export failed: ' + err.message);
  } finally {
    setButtonBusy(exportButton, false);
  }
}

function handleQcFilterChange() {
  qcState.severityFilter = getValue('qc-report-severity-filter') || 'all';
  qcState.categoryFilter = getValue('qc-report-category-filter') || 'all';
  renderQcReportView();
}

function handleQcRunSelectorChange() {
  var selectedRunId = getValue('qc-report-run-selector');
  if (!selectedRunId) {
    return;
  }
  qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId] = selectedRunId;
  renderQcReportView();
}

function handleQcSubmissionSelectorChange() {
  var selectedSubmissionId = getValue('qc-report-submission-selector');
  if (!selectedSubmissionId) {
    return;
  }
  void setActiveQcSubmission(selectedSubmissionId);
}

function syncQcSubmissionIdToState() {
  var id = getValue('qc-submission-id');
  if (id) {
    void setActiveQcSubmission(id);
  }
}

function restoreQcFilters() {
  setValue('qc-report-severity-filter', qcState.severityFilter);
  setValue('qc-report-category-filter', qcState.categoryFilter);
  renderQcSubmissionSelector();
  renderQcRunSelector();
}

async function handleQcRunFromReport() {
  if (!getValue('qc-submission-id')) {
    setValue('qc-submission-id', qcState.activeSubmissionId || 'sub-local-1');
  }
  await handleQcRun();
}

async function handleQcLoadRules() {
  if (!api || !api.qc || !api.qc.listRules) {
    setFeedback('qc-feedback', 'warning', 'QC API not available.'); return;
  }
  setFeedback('qc-feedback', '', '');
  var btn = document.getElementById('qc-rules-button');
  setButtonBusy(btn, true);
  try {
    var r = await api.qc.listRules();
    if (!r.ok) {
      setFeedback('qc-feedback', 'error', r.error.message || 'Failed to load rules.'); return;
    }
    var out = document.getElementById('qc-rules-output');
    if (out) { out.textContent = toPrettyJson(r.data); }
    setFeedback('qc-feedback', '', 'Rules loaded: ' + (r.data.rules ? r.data.rules.length : 0) + ' entries.');
    var el = document.getElementById('qc-feedback');
    if (el) { el.textContent = 'Rules loaded: ' + (r.data.rules ? r.data.rules.length : 0) + ' entries.'; el.className = 'auth-feedback'; }
  } catch (err) {
    setFeedback('qc-feedback', 'error', 'Failed to load rules: ' + err.message);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleQcPolicyLoad() {
  if (!api || !api.qc || !api.qc.getPolicy) {
    setFeedback('qc-feedback', 'warning', 'QC policy API not available.'); return;
  }
  var btn = document.getElementById('qc-policy-button');
  setButtonBusy(btn, true);
  try {
    var r = await api.qc.getPolicy();
    if (!r.ok) { return; }
    var ta = document.getElementById('qc-policy-json');
    if (ta) { ta.value = toPrettyJson(r.data.policy); }
    var out = document.getElementById('qc-policy-output');
    if (out) { out.textContent = 'Policy loaded: ' + r.data.policy.policyId; }
  } catch (_) { }
  finally { setButtonBusy(btn, false); }
}

async function handleQcPolicySave() {
  if (!api || !api.qc || !api.qc.updatePolicy) { return; }
  var btn = document.getElementById('qc-policy-save-button');
  setButtonBusy(btn, true);
  try {
    var raw = getValue('qc-policy-json');
    var policy = JSON.parse(raw);
    var r = await api.qc.updatePolicy({ policy });
    var out = document.getElementById('qc-policy-output');
    if (out) { out.textContent = r.ok ? ('Saved: v' + r.data.policy.version) : ('Error: ' + r.error.message); }
  } catch (err) {
    var out = document.getElementById('qc-policy-output');
    if (out) { out.textContent = 'Invalid JSON: ' + err.message; }
  } finally {
    setButtonBusy(btn, false);
  }
}

function wireQcAdminFlows() {
  document.getElementById('qc-run-button')?.addEventListener('click', handleQcRun);
  document.getElementById('qc-rules-button')?.addEventListener('click', handleQcLoadRules);
  document.getElementById('qc-submission-id')?.addEventListener('change', syncQcSubmissionIdToState);
  document.getElementById('qc-report-submission-selector')?.addEventListener('change', handleQcSubmissionSelectorChange);
  document.getElementById('qc-report-run-selector')?.addEventListener('change', handleQcRunSelectorChange);
  document.getElementById('qc-policy-button')?.addEventListener('click', handleQcPolicyLoad);
  document.getElementById('qc-policy-save-button')?.addEventListener('click', handleQcPolicySave);
  document.getElementById('qc-report-severity-filter')?.addEventListener('change', handleQcFilterChange);
  document.getElementById('qc-report-category-filter')?.addEventListener('change', handleQcFilterChange);
  document.getElementById('qc-report-rerun-button')?.addEventListener('click', handleQcRunFromReport);
  document.getElementById('qc-report-export-button')?.addEventListener('click', handleQcExportReport);
  restoreQcFilters();
  refreshQcSubmissionHistoryIndex().then(function () {
    renderQcReportView();
  });
}

/* ═══════════════════════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════════════════════ */

function formatNotificationLabel(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function getNotificationFilters() {
  return {
    type: getValue('notifications-type-filter'),
    severity: getValue('notifications-severity-filter'),
    status: getValue('notifications-status-filter'),
  };
}

function isCreatorOnlyActor() {
  var roles = Array.isArray(appState.actor.roles) ? appState.actor.roles : [];
  var hasReviewerOrAdmin = roles.indexOf('reviewer') !== -1 || roles.indexOf('admin') !== -1;
  return !hasReviewerOrAdmin;
}

function configureNotificationRoleScope(role) {
  var roleEl = document.getElementById('notifications-role') || document.getElementById('notifications-active-role');
  if (!roleEl) { return; }
  roleEl.value = role || 'creator';
  roleEl.disabled = isCreatorOnlyActor();
}

function isRoleVisibleNotification(notification, role) {
  if (role !== 'creator') { return true; }
  var creatorVisibleTypes = {
    qc_failed: true,
    submitted: true,
    under_review: true,
    approved: true,
    rejected: true,
    scheduled: true,
    released: true,
  };
  return creatorVisibleTypes[String(notification.type || '').toLowerCase()] === true;
}

function matchesNotificationFilters(n, filters) {
  if (filters.type && n.type !== filters.type) { return false; }
  if (filters.severity && n.severity !== filters.severity) { return false; }
  if (filters.status && n.status !== filters.status) { return false; }
  return true;
}

function canRetryNotification(n, role) {
  if (n.status !== 'failed') { return false; }
  if (role === 'reviewer' || role === 'admin') { return true; }
  var actorRoles = Array.isArray(appState.actor && appState.actor.roles) ? appState.actor.roles : [];
  return actorRoles.indexOf('reviewer') !== -1 || actorRoles.indexOf('admin') !== -1;
}

function setElementAttribute(el, name, value) {
  if (!el) { return; }
  if (typeof el.setAttribute === 'function') {
    el.setAttribute(name, value);
    return;
  }
  el[name] = value;
}

function getNotificationActionSubject(notification) {
  return notification.title || notification.notificationId || notification.id || 'this notification';
}

function isBackendUnreachableError(errorLike) {
  if (!errorLike) { return false; }
  var reason = String(errorLike.reason || '').toLowerCase();
  var message = String(errorLike.message || '').toLowerCase();
  return (
    reason.indexOf('backend_unreachable') !== -1 ||
    message.indexOf('backend') !== -1 ||
    message.indexOf('network') !== -1 ||
    message.indexOf('fetch') !== -1 ||
    message.indexOf('unreachable') !== -1
  );
}

function buildNotificationLoadFeedback(options) {
  var hasExisting = Boolean(options && options.hasExisting);
  var backendUnreachable = Boolean(options && options.backendUnreachable);
  var empty = Boolean(options && options.empty);
  if (empty) {
    return {
      tone: 'warning',
      message: 'No notifications yet. New lifecycle updates will appear here.',
    };
  }
  if (backendUnreachable && hasExisting) {
    return {
      tone: 'warning',
      message: 'Showing last loaded notifications. Backend is unreachable; retry when API service is back.',
    };
  }
  if (backendUnreachable) {
    return {
      tone: 'error',
      message: 'Notifications unavailable because backend is unreachable. Start API service, then retry.',
    };
  }
  if (hasExisting) {
    return {
      tone: 'warning',
      message: 'Showing last loaded notifications. Latest refresh failed; retry to sync.',
    };
  }
  return {
    tone: 'error',
    message: 'Failed to load notifications. Retry after confirming backend health.',
  };
}

function createNotificationEmptyState(msg) {
  var p = document.createElement('p');
  p.className = 'auth-subtle p-3';
  setElementAttribute(p, 'data-testid', 'notification-empty-state');
  p.textContent = msg;
  return p;
}

function getNotificationNextStep(notification, actorRole) {
  var type = String(notification.type || '').toLowerCase();

  if (type === 'qc_failed') {
    return 'Next step: open Submissions, resolve all blocking QC findings, then run QC again.';
  }
  if (type === 'submitted' || type === 'under_review') {
    if (actorRole === 'creator') {
      return 'Next step: track review progress in Submission History and wait for reviewer decision updates.';
    }
    return 'Next step: open Review Queue, inspect files, and record an approve/reject decision.';
  }
  if (type === 'approved') {
    return actorRole === 'creator'
      ? 'Next step: confirm release timing details, then monitor Scheduled and Released updates.'
      : 'Next step: verify scheduling payload, then monitor release pipeline health.';
  }
  if (type === 'rejected') {
    return actorRole === 'creator'
      ? 'Next step: open Submissions, apply the reviewer notes, rerun QC, and resubmit.'
      : 'Next step: ensure rejection reason and amendment guidance are complete for the creator.';
  }
  if (type === 'scheduled') {
    return 'Next step: verify release date details and confirm no blocking dependencies remain.';
  }
  if (type === 'released') {
    return actorRole === 'creator'
      ? 'Next step: review post-release details and start preparing your next submission.'
      : 'Next step: confirm release completion and close any outstanding review tasks.';
  }
  return 'Next step: open the linked workflow surface and complete the required follow-up action.';
}

function getNotificationSvgIcon(severity, status, type) {
  var s = String(severity || '').toLowerCase();
  var st = String(status || '').toLowerCase();
  var t = String(type || '').toLowerCase();
  // Error / Failed → exclamation triangle
  if (s === 'error' || st === 'failed') {
    return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>';
  }
  // Warning → alert
  if (s === 'warning') {
    return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>';
  }
  // Approved / Sent → checkmark
  if (st === 'sent' || t === 'approved') {
    return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd"/></svg>';
  }
  // Pending → clock
  if (st === 'pending') {
    return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clip-rule="evenodd"/></svg>';
  }
  // Default → bell / notification
  return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 0 0-6 6v3.586l-.707.707A1 1 0 0 0 4 14h12a1 1 0 0 0 .707-1.707L16 11.586V8a6 6 0 0 0-6-6ZM10 18a3 3 0 0 1-3-3h6a3 3 0 0 1-3 3Z"/></svg>';
}

function getNotificationIconTheme(severity, status, type) {
  var s = String(severity || '').toLowerCase();
  var st = String(status || '').toLowerCase();
  var t = String(type || '').toLowerCase();
  if (s === 'error' || st === 'failed') return 'bg-red-50 text-brand-danger border-brand-danger/20';
  if (s === 'warning') return 'bg-amber-50 text-brand-accent border-brand-accent/30';
  if (st === 'sent' || t === 'approved') return 'bg-green-50 text-green-600 border-green-200';
  if (st === 'pending') return 'bg-brand-surface text-brand-text border-brand-border';
  return 'bg-brand-surface text-brand-text border-brand-border';
}

function createNotificationCard(notification, actorRole) {
  var row = document.createElement('div');
  var isUnread = !notification.read;
  var isError = notification.severity === 'error' || notification.status === 'failed';

  /* Card container — unread cards get a left accent border */
  if (isUnread) {
    row.className = 'notification-card relative' + (isError ? ' border-l-4 border-l-brand-danger' : ' border-l-4 border-l-brand-accent');
  } else {
    row.className = 'notification-card opacity-80';
  }

  /* Unread indicator dot */
  if (isUnread) {
    var dotWrap = document.createElement('div');
    dotWrap.className = 'absolute top-3 right-3';
    var dot = document.createElement('span');
    dot.className = 'block h-2 w-2 rounded-full animate-pulse ' + (isError ? 'bg-brand-danger' : 'bg-brand-accent');
    dotWrap.appendChild(dot);
    row.appendChild(dotWrap);
  }

  var flexRow = document.createElement('div');
  flexRow.className = 'flex gap-3';

  /* Icon circle */
  var iconWrap = document.createElement('div');
  iconWrap.className = 'h-9 w-9 shrink-0 rounded-full flex items-center justify-center border ' + getNotificationIconTheme(notification.severity, notification.status, notification.type);
  iconWrap.innerHTML = getNotificationSvgIcon(notification.severity, notification.status, notification.type);
  flexRow.appendChild(iconWrap);

  /* Content column */
  var contentCol = document.createElement('div');
  contentCol.className = 'flex-1 min-w-0';

  /* Title row with chips */
  var titleRow = document.createElement('div');
  titleRow.className = 'flex flex-wrap items-center gap-2 mb-1';

  var title = document.createElement('span');
  title.className = 'text-sm font-semibold text-brand-text-strong';
  var titleText = notification.title || notification.notificationId || notification.id || 'Notification';
  if (titleText.length > 30 && titleText.indexOf('-') > -1) {
    titleText = titleText.split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ').substring(0, 28) + '…';
  }
  title.textContent = titleText;
  titleRow.appendChild(title);

  /* Status chips */
  [formatNotificationLabel(notification.type), formatNotificationLabel(notification.severity), formatNotificationLabel(notification.status)].forEach(function (label) {
    if (!label) return;
    var chip = document.createElement('span');
    chip.className = 'notification-chip';
    chip.textContent = label;
    titleRow.appendChild(chip);
  });

  /* Timestamp — pushed right */
  if (notification.createdAt) {
    var date = document.createElement('span');
    date.className = 'text-xs text-brand-text opacity-60 ml-auto';
    var d = new Date(notification.createdAt);
    date.textContent = isNaN(d) ? '' : d.toLocaleString();
    titleRow.appendChild(date);
  }
  contentCol.appendChild(titleRow);

  /* Message body */
  if (notification.message) {
    var msg = document.createElement('p');
    msg.className = 'text-sm text-brand-text opacity-80 mb-2 line-clamp-2';
    msg.textContent = 'What changed: ' + notification.message;
    contentCol.appendChild(msg);
  }

  var nextStep = document.createElement('p');
  nextStep.className = 'text-xs text-brand-text mb-2';
  nextStep.textContent = getNotificationNextStep(notification, actorRole);
  contentCol.appendChild(nextStep);

  /* Action buttons */
  var actions = document.createElement('div');
  actions.className = 'notification-actions';

  if (!notification.read) {
    var markBtn = document.createElement('button');
    markBtn.className = 'auth-button-secondary text-xs py-1 px-3';
    markBtn.type = 'button';
    markBtn.textContent = 'Mark Read';
    setElementAttribute(markBtn, 'data-testid', 'notification-mark-read');
    setElementAttribute(markBtn, 'data-testid', 'notification-action-mark-read');
    setElementAttribute(markBtn, 'aria-label', 'Mark notification "' + getNotificationActionSubject(notification) + '" as read');
    markBtn.addEventListener('click', function () { handleMarkNotificationRead(notification.notificationId || notification.id); });
    actions.appendChild(markBtn);
  }

  if (canRetryNotification(notification, actorRole)) {
    var retryBtn = document.createElement('button');
    retryBtn.className = 'fe-danger-btn text-xs py-1 px-3';
    retryBtn.type = 'button';
    retryBtn.textContent = 'Retry Sending';
    setElementAttribute(retryBtn, 'data-testid', 'notification-retry-dispatch');
    setElementAttribute(retryBtn, 'data-testid', 'notification-action-retry-dispatch');
    setElementAttribute(retryBtn, 'aria-label', 'Retry dispatch for notification "' + getNotificationActionSubject(notification) + '"');
    retryBtn.addEventListener('click', function () { handleRetryNotification(notification.notificationId || notification.id); });
    actions.appendChild(retryBtn);
  }

  if (actions.children.length > 0) { contentCol.appendChild(actions); }

  flexRow.appendChild(contentCol);
  row.appendChild(flexRow);

  return row;
}

function renderNotificationLists() {
  var listContainer = document.getElementById('notifications-list');
  var markAllBtn = document.getElementById('notifications-mark-all-button');
  if (!listContainer) { return; }

  var unreadList = document.getElementById('notifications-unread-list');
  var readList = document.getElementById('notifications-read-list');

  if (unreadList) { unreadList.textContent = ''; }
  if (readList) { readList.textContent = ''; }
  if (!unreadList || !readList) { listContainer.textContent = ''; }

  var actorRole = getActiveActorRole();
  var filters = getNotificationFilters();

  var filtered = notificationState.notifications
    .filter(function (n) { return isRoleVisibleNotification(n, actorRole); })
    .filter(function (n) { return matchesNotificationFilters(n, filters); })
    .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  setElementAttribute(listContainer, 'data-visible-count', String(filtered.length));

  if (unreadList && readList) {
    var unread = filtered.filter(function (n) { return !n.read; });
    var read = filtered.filter(function (n) { return n.read; });

    if (unread.length === 0) {
      unreadList.appendChild(createNotificationEmptyState('No unread notifications. Select Refresh to check for updates, or open Submissions to continue your creator workflow.'));
    } else {
      unread.forEach(function (n) {
        unreadList.appendChild(createNotificationCard(n, actorRole));
      });
    }

    if (read.length === 0) {
      readList.appendChild(createNotificationEmptyState('No read notifications yet. Mark updates as read to build your completed history.'));
    } else {
      read.forEach(function (n) {
        readList.appendChild(createNotificationCard(n, actorRole));
      });
    }
  } else if (filtered.length === 0) {
    listContainer.appendChild(createNotificationEmptyState('No notifications found.'));
  } else {
    filtered.forEach(function (n) {
      listContainer.appendChild(createNotificationCard(n, actorRole));
    });
  }

  var unreadCount = filtered.filter(function (n) { return !n.read; }).length;
  if (markAllBtn) { markAllBtn.disabled = unreadCount === 0; }

  var unreadCountEl = document.getElementById('notifications-unread-count');
  if (unreadCountEl) {
    unreadCountEl.textContent = String(unreadCount);
    setElementAttribute(unreadCountEl, 'data-count', String(unreadCount));
  }
  var unreadCountInlineEl = document.getElementById('notifications-unread-count-inline');
  if (unreadCountInlineEl) {
    unreadCountInlineEl.textContent = '(' + unreadCount + ')';
  }
  var readCountEl = document.getElementById('notifications-read-count');
  if (readCountEl) {
    var readCountValue = Array.isArray(read) ? read.length : Math.max(filtered.length - unreadCount, 0);
    readCountEl.textContent = '(' + readCountValue + ')';
  }

  var totalCountEl = document.getElementById('notifications-total-count');
  if (totalCountEl) {
    totalCountEl.textContent = String(filtered.length);
    setElementAttribute(totalCountEl, 'data-count', String(filtered.length));
  }

  var nextStepEl = document.getElementById('notifications-next-step-guidance');
  if (nextStepEl) {
    if (filtered.length === 0) {
      nextStepEl.textContent = 'Next step: no notifications match this filter. Clear filters or select Refresh, then return to Submissions to continue your creator workflow.';
    } else if (unreadCount > 0) {
      nextStepEl.textContent = 'Next step: open unread updates and use Mark Read or Retry Sending so your creator queue stays clear.';
    } else {
      nextStepEl.textContent = 'Next step: inbox is clear. Use Submissions to continue preparing your next pack, then return here to confirm review outcomes.';
    }
  }

  /* Update sidebar badge */
  var badge = document.getElementById('notif-unread-badge');
  if (badge) {
    badge.textContent = String(unreadCount);
    setElementAttribute(badge, 'data-unread-count', String(unreadCount));
    setElementAttribute(badge, 'aria-label', 'Unread notifications: ' + unreadCount);
    if (badge.classList && typeof badge.classList.toggle === 'function') {
      badge.classList.toggle('hidden', unreadCount === 0);
    }
  }

  /* Update dashboard stat */
  var statEl = document.getElementById('stat-unread-notifs');
  if (statEl) { statEl.textContent = String(unreadCount); }
}

async function loadNotifications() {
  if (!api || !api.notifications || !api.notifications.list) {
    setFeedback('notifications-feedback', 'warning', 'Notifications API unavailable.'); return;
  }
  setFeedback('notifications-feedback', '', '');
  var btn = document.getElementById('notifications-load-button');
  setButtonBusy(btn, true);
  try {
    if (isCreatorOnlyActor()) {
      configureNotificationRoleScope('creator');
    }
    var actorRole = getActiveActorRole();
    notificationState.actorRole = actorRole;
    var r = await api.notifications.list({ actorId: notificationState.actorId, actorRole, includeRead: true });
    if (!r.ok) {
      var fb = buildNotificationLoadFeedback({
        hasExisting: Array.isArray(notificationState.notifications) && notificationState.notifications.length > 0,
        backendUnreachable: isBackendUnreachableError(r.error),
        empty: false,
      });
      setFeedback('notifications-feedback', fb.tone, fb.message); return;
    }
    notificationState.notifications = Array.isArray(r.data.notifications) ? r.data.notifications : [];
    var loadedFeedback = buildNotificationLoadFeedback({
      hasExisting: false,
      backendUnreachable: false,
      empty: notificationState.notifications.length === 0,
    });
    var el = document.getElementById('notifications-feedback');
    if (el) {
      el.textContent = notificationState.notifications.length === 0
        ? loadedFeedback.message
        : 'Inbox refreshed. Loaded ' + notificationState.notifications.length + ' notifications.';
      el.className = 'auth-feedback' + (notificationState.notifications.length === 0 ? (' ' + loadedFeedback.tone) : '');
    }
    renderNotificationLists();
  } catch (err) {
    var fb = buildNotificationLoadFeedback({
      hasExisting: Array.isArray(notificationState.notifications) && notificationState.notifications.length > 0,
      backendUnreachable: isBackendUnreachableError(err),
      empty: false,
    });
    setFeedback('notifications-feedback', fb.tone, fb.message);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleMarkNotificationRead(notificationId) {
  if (!api || !api.notifications || !api.notifications.markRead) { return; }
  try {
    var r = await api.notifications.markRead({ actorId: notificationState.actorId, actorRole: getActiveActorRole(), notificationIds: [notificationId] });
    if (r.ok) {
      var el = document.getElementById('notifications-feedback');
      if (el) { el.textContent = 'Marked as read.'; el.className = 'auth-feedback'; }
      await loadNotifications();
    }
  } catch (_) { }
}

async function handleMarkAllNotificationsRead() {
  if (!api || !api.notifications || !api.notifications.markAllRead) { return; }
  var btn = document.getElementById('notifications-mark-all-button');
  setButtonBusy(btn, true);
  try {
    var r = await api.notifications.markAllRead({ actorId: notificationState.actorId, actorRole: getActiveActorRole() });
    if (r.ok) {
      var el = document.getElementById('notifications-feedback');
      if (el) { el.textContent = 'Marked ' + r.data.updatedCount + ' as read.'; el.className = 'auth-feedback'; }
      await loadNotifications();
    }
  } catch (_) { } finally { setButtonBusy(btn, false); }
}

async function handleRetryNotification(notificationId) {
  if (!api || !api.notifications || !api.notifications.retry) { return; }
  setFeedback('notifications-feedback', '', '');
  try {
    var r = await api.notifications.retry({ actorId: notificationState.actorId, actorRole: getActiveActorRole(), notificationId });
    if (r.ok) {
      var el = document.getElementById('notifications-feedback');
      if (el) { el.textContent = 'Retry dispatch queued.'; el.className = 'auth-feedback'; }
      await loadNotifications();
    } else {
      var el = document.getElementById('notifications-feedback');
      if (el) { el.textContent = 'Retry failed: ' + (r.error ? r.error.message : 'Unknown error'); el.className = 'auth-feedback error'; }
    }
  } catch (err) {
    var el = document.getElementById('notifications-feedback');
    if (el) { el.textContent = 'Retry error: ' + err.message; el.className = 'auth-feedback error'; }
  }
}

function wireNotificationCenter() {
  if (typeof document.createElement !== 'function') { return; }

  var listContainer = document.getElementById('notifications-list');
  if (!listContainer) { return; }

  document.getElementById('notifications-load-button')?.addEventListener('click', function () { void loadNotifications(); });
  document.getElementById('notifications-mark-all-button')?.addEventListener('click', function () { void handleMarkAllNotificationsRead(); });
  (document.getElementById('notifications-role') || document.getElementById('notifications-active-role'))?.addEventListener('change', function () {
    if (isCreatorOnlyActor()) {
      configureNotificationRoleScope('creator');
    }
    notificationState.actorRole = getActiveActorRole();
    renderNotificationLists();
  });
  ['notifications-type-filter', 'notifications-severity-filter', 'notifications-status-filter'].forEach(function (id) {
    document.getElementById(id)?.addEventListener('change', renderNotificationLists);
  });
  if (typeof window !== 'undefined' && window.uiDropdownMenu && typeof window.uiDropdownMenu.wire === 'function') {
    if (notificationDropdownController && typeof notificationDropdownController.destroy === 'function') {
      notificationDropdownController.destroy();
    }
    notificationDropdownController = window.uiDropdownMenu.wire([
      { selectId: 'notifications-type-filter', triggerId: 'notifications-type-trigger', menuId: 'notifications-type-menu', labelId: 'notifications-type-label' },
      { selectId: 'notifications-severity-filter', triggerId: 'notifications-severity-trigger', menuId: 'notifications-severity-menu', labelId: 'notifications-severity-label' },
      { selectId: 'notifications-status-filter', triggerId: 'notifications-status-trigger', menuId: 'notifications-status-menu', labelId: 'notifications-status-label' },
    ], { rootSelector: '.ui-dropdown' });
  } else {
    if (notificationDropdownController && typeof notificationDropdownController.destroy === 'function') {
      notificationDropdownController.destroy();
    }
    notificationDropdownController = wireNotificationDropdownFallback();
  }
  configureNotificationRoleScope(notificationState.actorRole);
  renderNotificationLists();

  /* Auto-load only in a real browser context (has classList on notification containers) */
  if (listContainer.classList && typeof listContainer.classList.remove === 'function') {
    void loadNotifications();
  }
}

function wireNotificationDropdownFallback() {
  var specs = [
    { triggerId: 'notifications-type-trigger', menuId: 'notifications-type-menu' },
    { triggerId: 'notifications-severity-trigger', menuId: 'notifications-severity-menu' },
    { triggerId: 'notifications-status-trigger', menuId: 'notifications-status-menu' },
  ].map(function (spec) {
    return {
      trigger: document.getElementById(spec.triggerId),
      menu: document.getElementById(spec.menuId),
    };
  }).filter(function (spec) {
    return Boolean(spec.trigger && spec.menu);
  });

  function closeAll(exceptMenu) {
    specs.forEach(function (spec) {
      if (exceptMenu && spec.menu === exceptMenu) { return; }
      spec.menu.classList.add('hidden');
      spec.trigger.setAttribute('aria-expanded', 'false');
      var root = spec.trigger.closest('.ui-dropdown');
      if (root) { root.classList.remove('is-open'); }
      spec.trigger.classList.remove('is-open');
    });
  }

  specs.forEach(function (spec) {
    spec.trigger.addEventListener('click', function (event) {
      event.preventDefault();
      var isOpen = !spec.menu.classList.contains('hidden');
      if (isOpen) {
        closeAll(null);
        return;
      }
      closeAll(spec.menu);
      spec.menu.classList.remove('hidden');
      spec.trigger.setAttribute('aria-expanded', 'true');
      var root = spec.trigger.closest('.ui-dropdown');
      if (root) { root.classList.add('is-open'); }
      spec.trigger.classList.add('is-open');
    });
  });

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function' || !target.closest('.ui-dropdown')) {
      closeAll(null);
    }
  }
  var canAttachDocumentListeners = document && typeof document.addEventListener === 'function' && typeof document.removeEventListener === 'function';
  if (canAttachDocumentListeners) {
    document.addEventListener('click', onDocumentClick);
  }

  return {
    destroy: function () {
      if (canAttachDocumentListeners) {
        document.removeEventListener('click', onDocumentClick);
      }
      closeAll(null);
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   OPERATIONS FLOWS
═══════════════════════════════════════════════════════════ */

function appendOpsTimeline(entry) {
  var out = document.getElementById('ops-timeline-output');
  if (!out) { return; }
  var line = '[' + new Date().toISOString() + '] ' + entry;
  out.textContent = (line + '\n' + (out.textContent || '')).trim();
}

function requiredOpsValue(id, label) {
  var val = getValue(id);
  if (!val) { throw new Error(label + ' is required'); }
  return val;
}

function buildSchedulingEvent(submissionId, actorId, preferredMonth) {
  return {
    eventName: 'submission.approved.scheduling.v1', schemaVersion: 1, submissionId,
    transitionId: 'transition-' + Date.now(), occurredAt: new Date().toISOString(),
    approvedBy: actorId, preferredReleaseMonth: preferredMonth,
    idempotencyKey: 'submission.approved.scheduling.v1:' + submissionId + ':' + Date.now(),
  };
}

function buildOpsIncidentIdempotencyKey(payload) {
  var base = [
    payload.source,
    payload.severity,
    payload.note.trim().toLowerCase(),
    payload.linkedEntity,
    payload.failureClass || 'none',
    payload.correlationId || 'none',
    payload.auditEventId || 'none',
  ].join('|');
  var hash = 0;
  for (var i = 0; i < base.length; i += 1) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) >>> 0;
  }
  return 'ops-incident-' + hash.toString(16);
}

function inferFailureClassFromOpsContext(note, jobId) {
  if (jobId) { return 'retry_exhaustion'; }
  var lower = note.toLowerCase();
  if (lower.indexOf('schedule') >= 0 || lower.indexOf('release') >= 0) {
    return 'scheduling_terminal_failure';
  }
  if (lower.indexOf('integration') >= 0 || lower.indexOf('airtable') >= 0 || lower.indexOf('dropbox') >= 0) {
    return 'integration_failure';
  }
  return null;
}

function summarizeOpsMetricsSnapshot(snapshot) {
  var lines = String(snapshot || '').split('\n');
  var queueDepth = 'n/a';
  var incidentCount = '0';
  var failureSummaries = [];
  lines.forEach(function (line) {
    if (!line || line.charAt(0) === '#') { return; }
    if (line.indexOf('splice_api_background_job_queue_depth') === 0) {
      queueDepth = (line.split(' ').pop() || 'n/a').trim();
      return;
    }
    if (line.indexOf('splice_api_incident_annotations_total') === 0) {
      incidentCount = (line.split(' ').pop() || incidentCount).trim();
      return;
    }
    if (line.indexOf('splice_api_failure_class_total') === 0) {
      failureSummaries.push(line);
    }
  });
  return [
    'Actionable signals:',
    '- Queue depth: ' + queueDepth,
    '- Incident annotations: ' + incidentCount,
    '- Failure classes:',
    failureSummaries.length > 0 ? failureSummaries.join('\n') : 'none',
  ].join('\n');
}

async function runOpsAction(buttonId, action) {
  var btn = document.getElementById(buttonId);
  setButtonBusy(btn, true);
  setFeedback('ops-feedback', '', '');
  try { await action(); }
  catch (err) { setFeedback('ops-feedback', 'error', err.message); appendOpsTimeline('error: ' + err.message); }
  finally { setButtonBusy(btn, false); }
}

function wireOperationsFlows() {
  document.getElementById('ops-jobs-enqueue')?.addEventListener('click', function () {
    runOpsAction('ops-jobs-enqueue', async function () {
      var submissionId = requiredOpsValue('ops-submission-id', 'Submission ID');
      var r = await api.jobs.enqueue({ requestId: 'enqueue-' + Date.now(), jobType: 'release.trigger', idempotencyKey: 'release.trigger:' + submissionId, payloadJson: { submissionId } });
      if (!r.ok) { throw new Error(r.error.message); }
      setFeedback('ops-feedback', '', 'Enqueued job ' + r.data.job.id + '.');
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Enqueued job ' + r.data.job.id + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('job enqueued ' + r.data.job.id);
    });
  });

  document.getElementById('ops-jobs-get')?.addEventListener('click', function () {
    runOpsAction('ops-jobs-get', async function () {
      var jobId = requiredOpsValue('ops-job-id', 'Job ID');
      var r = await api.jobs.get({ id: jobId });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Job ' + r.data.job.id + ' is ' + r.data.job.status + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('job lookup ' + r.data.job.id + ':' + r.data.job.status);
    });
  });

  document.getElementById('ops-jobs-replay')?.addEventListener('click', function () {
    runOpsAction('ops-jobs-replay', async function () {
      var jobId = requiredOpsValue('ops-job-id', 'Job ID');
      var actorId = requiredOpsValue('ops-actor-id', 'Actor ID');
      var r = await api.jobs.replay({ id: jobId, requestId: 'replay-' + Date.now(), actorId, reason: 'manual replay from operations ui' });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Replay accepted for ' + r.data.job.id + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('job replayed ' + r.data.job.id);
    });
  });

  document.getElementById('ops-scheduling-resolve')?.addEventListener('click', function () {
    runOpsAction('ops-scheduling-resolve', async function () {
      var submissionId = requiredOpsValue('ops-submission-id', 'Submission ID');
      var actorId = requiredOpsValue('ops-actor-id', 'Actor ID');
      var preferredMonth = requiredOpsValue('ops-preferred-month', 'Preferred month');
      var r = await api.scheduling.resolve({ requestId: 'resolve-' + Date.now(), submissionId, schedulingEvent: buildSchedulingEvent(submissionId, actorId, preferredMonth), timezone: 'UTC' });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Resolved schedule v' + r.data.schedule.version + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('schedule resolved ' + r.data.schedule.submissionId);
    });
  });

  document.getElementById('ops-scheduling-override')?.addEventListener('click', function () {
    runOpsAction('ops-scheduling-override', async function () {
      var submissionId = requiredOpsValue('ops-submission-id', 'Submission ID');
      var actorId = requiredOpsValue('ops-actor-id', 'Actor ID');
      var newReleaseAt = new Date(Date.now() + 7 * 86400000).toISOString();
      var r = await api.scheduling.override({ requestId: 'override-' + Date.now(), submissionId, newReleaseAt, reason: 'manual override from operations ui', actorId, actorRole: 'admin', timezone: 'UTC' });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Override saved for ' + submissionId + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('schedule overridden ' + submissionId);
    });
  });

  document.getElementById('ops-scheduling-trigger')?.addEventListener('click', function () {
    runOpsAction('ops-scheduling-trigger', async function () {
      var submissionId = requiredOpsValue('ops-submission-id', 'Submission ID');
      var actorId = requiredOpsValue('ops-actor-id', 'Actor ID');
      var r = await api.scheduling.triggerRelease({ requestId: 'trigger-' + Date.now(), submissionId, actorId, actorRole: 'admin', force: true });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Release triggered for ' + submissionId + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('release triggered ' + submissionId);
    });
  });

  document.getElementById('ops-observability-metrics')?.addEventListener('click', function () {
    runOpsAction('ops-observability-metrics', async function () {
      var r = await api.observability.getMetrics();
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Loaded metrics snapshot.'; el.className = 'auth-feedback'; }
      var actionable = summarizeOpsMetricsSnapshot(r.data.snapshot);
      setText('ops-status-output', actionable + '\n\nRaw (truncated):\n' + r.data.snapshot.slice(0, 1400));
      appendOpsTimeline('metrics snapshot loaded');
    });
  });

  document.getElementById('ops-observability-annotate')?.addEventListener('click', function () {
    runOpsAction('ops-observability-annotate', async function () {
      var note = requiredOpsValue('ops-annotation-note', 'Annotation note');
      var submissionId = (getValue('ops-submission-id') || '').trim();
      var linkedEntity = submissionId ? ('submission:' + submissionId) : 'operations';
      var jobId = (getValue('ops-job-id') || '').trim();
      var failureClass = inferFailureClassFromOpsContext(note, jobId);
      var payload = {
        source: 'desktop-operations-ui',
        severity: failureClass ? 'critical' : 'warning',
        note: note,
        linkedEntity: linkedEntity,
        failureClass: failureClass,
        correlationId: jobId ? ('job:' + jobId) : null,
        remediationStatus: 'open',
        remediationLink: jobId ? ('/admin/jobs/' + jobId) : null,
        requestId: 'incident-' + Date.now(),
      };
      payload.idempotencyKey = buildOpsIncidentIdempotencyKey(payload);
      var r = await api.observability.annotateIncident(payload);
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Annotation ' + r.data.annotation.id + ' saved.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('incident annotation ' + r.data.annotation.id);
    });
  });

  document.getElementById('ops-audit-events-btn')?.addEventListener('click', async function () {
    if (!api || !api.audit) { return; }
    try {
      var r = await api.audit.listSecurityEvents({ limit: 20, includeResolved: false });
      var out = document.getElementById('ops-audit-output');
      if (out) { out.textContent = r.ok ? toPrettyJson(r.data) : r.error.message; }
    } catch (err) {
      var out = document.getElementById('ops-audit-output');
      if (out) { out.textContent = err.message; }
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   SESSION BOOTSTRAP
═══════════════════════════════════════════════════════════ */

async function hydrateSessionContext() {
  if (
    api &&
    api.system &&
    api.system.runtime &&
    api.system.runtime.bypassAuth !== true
  ) {
    return;
  }
  if (!api || !api.auth || !api.auth.getSession) { return; }
  var r;
  try { r = await api.auth.getSession({ includePermissions: false }); }
  catch (_) { return; }
  if (!r || !r.ok) { return; }
  /* Guard: test teardown may delete global.document/window before this resolves */
  try {
    var docRef = (typeof globalThis !== 'undefined' ? globalThis : global).document;
    if (!docRef || typeof window === 'undefined' || !window.fileeaters) { return; }
    applyUserContext({ id: r.data.actor.id, roles: r.data.actor.roles });
    setNavigationEnabled(true);
    navigateTo('dashboard');
    if (api.system) {
      if (api.system.versions) {
        setText('electron-version', api.system.versions.electron || '—');
        setText('chrome-version', api.system.versions.chrome || '—');
      }
      if (api.system.runtime) {
        setText('environment-name', api.system.runtime.environment || '—');
        setText('health-port', api.system.runtime.healthPort ? String(api.system.runtime.healthPort) : '—');
        var versionEl = docRef.getElementById ? docRef.getElementById('sidebar-version') : null;
        if (versionEl) { versionEl.textContent = 'env: ' + (api.system.runtime.environment || '?'); }
      }
    }
  } catch (_) { /* Swallow: test teardown may race with this async resolution */ }
}



/* ═══════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════ */

function bootstrapRenderer() {
  /* 1. Inject all view HTML into mount */
  injectViews();

  if (!api) {
    navigateTo('auth');
    setActiveTab('login');
    wireTabs();
    var fb = document.getElementById('login-feedback');
    if (fb) {
      fb.textContent = 'Desktop auth bridge unavailable. Check preload configuration.';
      fb.className = 'auth-feedback error';
    }
    return;
  }

  /* 2. Wire navigation */
  wireNav();
  wireProfileMenu();
  setNavigationEnabled(false);

  /* 3. Show auth on startup */
  navigateTo('auth');
  setActiveTab('login');
  wireTabs();

  /* 4. Wire all IPC forms */
  wireAuthFlows();
  wireQcAdminFlows();
  wireNotificationCenter();
  wireOperationsFlows();

  /* 5. Wire new view modules */
  if (typeof window !== 'undefined') {
    if (window.viewDashboard && window.viewDashboard.wire) { window.viewDashboard.wire(); }
    if (window.viewSubmissions && window.viewSubmissions.wire) { window.viewSubmissions.wire(); }
    if (window.viewReviewerQueue && window.viewReviewerQueue.wire) { window.viewReviewerQueue.wire({ api: api }); }
    if (window.viewReviewerDecision && window.viewReviewerDecision.wire) { window.viewReviewerDecision.wire({ api: api }); }
    if (!appState.adminViewWired && window.viewAdminOps && window.viewAdminOps.wire) {
      appState.adminViewWired = true;
      window.viewAdminOps.wire({ api: api });
    }
    if (window.viewSettings && window.viewSettings.wire) { window.viewSettings.wire(api); }
  }

  /* 6. Session hydration (async, best-effort) */
  hydrateSessionContext();
}

bootstrapRenderer();

if (typeof module === 'object' && module.exports) {
  module.exports = {
    resolveNavigableView: resolveNavigableView,
    DEPRECATED_CREATOR_ROUTE_REDIRECTS: DEPRECATED_CREATOR_ROUTE_REDIRECTS,
  };
}
