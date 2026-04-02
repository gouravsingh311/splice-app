(function (global) {
/* Notification Center Flows (PRD-10) */
/* globals notificationState, appState, api, getValue, setButtonBusy, setFeedback */

var notificationDropdownController = null;
var NOTIFICATION_COPY_LABELS = {
  whatChanged: 'What changed:',
  nextStep: 'Next step:',
};

function getNotificationFilters() {
  return {
    type: getValue('notifications-type-filter'),
    severity: getValue('notifications-severity-filter'),
    status: getValue('notifications-status-filter'),
  };
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

function getActiveNotificationRole() {
  var roleInput = document.getElementById('notifications-active-role');
  if (roleInput && roleInput.value) { return roleInput.value; }
  return getActiveActorRole();
}

function syncActiveRoleFromActor() {
  var roleInput = document.getElementById('notifications-active-role');
  if (!roleInput) { return; }
  var roles = (appState && appState.actor && Array.isArray(appState.actor.roles)) ? appState.actor.roles : [];
  var resolved = (typeof resolvePrimaryActorRole === 'function')
    ? resolvePrimaryActorRole(roles)
    : { role: roles[0] || notificationState.actorRole || 'creator' };
  roleInput.value = resolved.role || 'creator';
}

function getNotificationId(notification) {
  return notification.notificationId || notification.id || '';
}

function canRetryNotification(notification, role) {
  return notification.status === 'failed' && (role === 'reviewer' || role === 'admin');
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

function matchesNotificationFilters(notification, filters) {
  if (filters.type && notification.type !== filters.type) { return false; }
  if (filters.severity && notification.severity !== filters.severity) { return false; }
  if (filters.status && notification.status !== filters.status) { return false; }
  return true;
}

function cloneNotifications(items) {
  return (Array.isArray(items) ? items : []).map(function (item) {
    var clone = {};
    Object.keys(item || {}).forEach(function (key) {
      clone[key] = item[key];
    });
    return clone;
  });
}

function markLocalRead(notificationIds) {
  var ids = {};
  notificationIds.forEach(function (id) { ids[id] = true; });
  var changed = false;
  var nowIso = new Date().toISOString();
  notificationState.notifications = notificationState.notifications.map(function (item) {
    var itemId = getNotificationId(item);
    if (!ids[itemId] || item.read) { return item; }
    changed = true;
    var next = {};
    Object.keys(item).forEach(function (key) { next[key] = item[key]; });
    next.read = true;
    next.readAt = nowIso;
    return next;
  });
  return changed;
}

function markLocalAllRead() {
  var changed = false;
  var nowIso = new Date().toISOString();
  notificationState.notifications = notificationState.notifications.map(function (item) {
    if (item.read) { return item; }
    changed = true;
    var next = {};
    Object.keys(item).forEach(function (key) { next[key] = item[key]; });
    next.read = true;
    next.readAt = nowIso;
    return next;
  });
  return changed;
}

function syncRoleChip() {
  var role = getActiveNotificationRole();
  var chip = document.getElementById('notifications-role-chip');
  if (chip) {
    chip.textContent = 'ROLE: ' + String(role || 'creator').toUpperCase();
  }
}

function maybeEmitRoleContractWarning() {
  if (!appState || !appState.roleContractViolation || notificationState.roleContractWarningShown) {
    return;
  }
  notificationState.roleContractWarningShown = true;
  var message = 'Session role payload returned multiple roles. Defaulting to ' + getActiveNotificationRole().toUpperCase() + ' for safety.';
  setFeedback('notifications-feedback', 'warning', message);

  if (global.console && typeof global.console.warn === 'function') {
    global.console.warn('[notifications.role.contract_violation]', {
      roles: appState.roleContractRoles || [],
      resolvedRole: getActiveNotificationRole(),
    });
  }

  if (api && api.audit && typeof api.audit.append === 'function' && !appState.roleContractViolationAudited) {
    appState.roleContractViolationAudited = true;
    try {
      void api.audit.append({
        action: 'notifications.role.contract_violation',
        actorId: notificationState.actorId,
        actorRole: getActiveNotificationRole(),
        metadata: {
          roles: appState.roleContractRoles || [],
        },
      });
    } catch (_) {}
  }
}

function renderNotificationLists() {
  var renderer = global.notificationRenderer;
  if (!renderer) { return; }

  var listContainer = document.getElementById('notifications-list');
  var markAllBtn = document.getElementById('notifications-mark-all-button');
  if (!listContainer) { return; }

  var unreadList = document.getElementById('notifications-unread-list');
  var readList = document.getElementById('notifications-read-list');

  if (unreadList) { unreadList.textContent = ''; }
  if (readList) { readList.textContent = ''; }
  if (!unreadList || !readList) { listContainer.textContent = ''; }

  var actorRole = getActiveNotificationRole();
  var filters = getNotificationFilters();
  var filtered = notificationState.notifications
    .filter(function (item) { return isRoleVisibleNotification(item, actorRole); })
    .filter(function (item) { return matchesNotificationFilters(item, filters); })
    .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

  listContainer.setAttribute('data-visible-count', String(filtered.length));

  var unread = filtered.filter(function (item) { return !item.read; });
  var read = filtered.filter(function (item) { return item.read; });

  var cardDeps = {
    getNotificationId: getNotificationId,
    canRetryNotification: canRetryNotification,
    onMarkRead: function (id) { void handleMarkNotificationRead(id); },
    onRetry: function (id) { void handleRetryNotification(id); },
  };

  if (unreadList && readList) {
    if (unread.length === 0) {
      unreadList.appendChild(renderer.createNotificationEmptyState('No unread notifications. Select Refresh to check for updates.'));
    } else {
      unread.forEach(function (item) {
        unreadList.appendChild(renderer.createNotificationCard(item, actorRole, cardDeps));
      });
    }

    if (read.length === 0) {
      readList.appendChild(renderer.createNotificationEmptyState('No read notifications yet. Mark updates as read to build history.'));
    } else {
      read.forEach(function (item) {
        readList.appendChild(renderer.createNotificationCard(item, actorRole, cardDeps));
      });
    }
  }

  if (markAllBtn) { markAllBtn.disabled = unread.length === 0; }

  var unreadCountEl = document.getElementById('notifications-unread-count');
  if (unreadCountEl) {
    unreadCountEl.textContent = String(unread.length);
    unreadCountEl.setAttribute('data-count', String(unread.length));
  }

  var unreadCountInlineEl = document.getElementById('notifications-unread-count-inline');
  if (unreadCountInlineEl) {
    unreadCountInlineEl.textContent = '(' + unread.length + ')';
  }

  var readCountEl = document.getElementById('notifications-read-count');
  if (readCountEl) {
    readCountEl.textContent = '(' + read.length + ')';
  }

  var totalCountEl = document.getElementById('notifications-total-count');
  if (totalCountEl) {
    totalCountEl.textContent = String(filtered.length);
    totalCountEl.setAttribute('data-count', String(filtered.length));
  }

  var nextStepEl = document.getElementById('notifications-next-step-guidance');
  if (nextStepEl) {
    if (filtered.length === 0) {
      nextStepEl.textContent = 'No notifications match this filter. Clear filters or refresh inbox.';
    } else if (unread.length > 0) {
      nextStepEl.textContent = 'Open unread updates and use Mark Read or Retry Sending to keep the queue clear.';
    } else {
      nextStepEl.textContent = 'Inbox is clear. Continue in Submissions and return for decision updates.';
    }
  }

  var badge = document.getElementById('notif-unread-badge');
  if (badge) {
    badge.textContent = String(unread.length);
    badge.setAttribute('data-unread-count', String(unread.length));
    badge.setAttribute('aria-label', 'Unread notifications: ' + unread.length);
    if (badge.classList && typeof badge.classList.toggle === 'function') {
      badge.classList.toggle('hidden', unread.length === 0);
    }
  }

  var statEl = document.getElementById('stat-unread-notifs');
  if (statEl) { statEl.textContent = String(unread.length); }
}

async function loadNotifications() {
  if (!api || !api.notifications || !api.notifications.list) {
    setFeedback('notifications-feedback', 'warning', 'Notifications API unavailable.');
    return;
  }

  setFeedback('notifications-feedback', '', '');
  var btn = document.getElementById('notifications-load-button');
  setButtonBusy(btn, true);

  try {
    syncActiveRoleFromActor();
    var actorRole = getActiveNotificationRole();
    notificationState.actorRole = actorRole;
    var response = await api.notifications.list({ actorId: notificationState.actorId, actorRole: actorRole, includeRead: true });

    if (!response.ok) {
      var fallback = buildNotificationLoadFeedback({
        hasExisting: Array.isArray(notificationState.notifications) && notificationState.notifications.length > 0,
        backendUnreachable: isBackendUnreachableError(response.error),
        empty: false,
      });
      setFeedback('notifications-feedback', fallback.tone, fallback.message);
      return;
    }

    notificationState.notifications = Array.isArray(response.data.notifications) ? response.data.notifications : [];
    var feedback = buildNotificationLoadFeedback({
      hasExisting: false,
      backendUnreachable: false,
      empty: notificationState.notifications.length === 0,
    });

    var feedbackEl = document.getElementById('notifications-feedback');
    if (feedbackEl) {
      feedbackEl.textContent = notificationState.notifications.length === 0
        ? feedback.message
        : 'Inbox refreshed. Loaded ' + notificationState.notifications.length + ' notifications.';
      feedbackEl.className = 'auth-feedback' + (notificationState.notifications.length === 0 ? (' ' + feedback.tone) : '');
    }

    syncRoleChip();
    maybeEmitRoleContractWarning();
    renderNotificationLists();
  } catch (err) {
    var errFallback = buildNotificationLoadFeedback({
      hasExisting: Array.isArray(notificationState.notifications) && notificationState.notifications.length > 0,
      backendUnreachable: isBackendUnreachableError(err),
      empty: false,
    });
    setFeedback('notifications-feedback', errFallback.tone, errFallback.message);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleMarkNotificationRead(notificationId) {
  if (!notificationId || !api || !api.notifications || !api.notifications.markRead) { return; }

  var previous = cloneNotifications(notificationState.notifications);
  if (!markLocalRead([notificationId])) { return; }
  renderNotificationLists();

  try {
    var response = await api.notifications.markRead({
      actorId: notificationState.actorId,
      actorRole: getActiveNotificationRole(),
      notificationIds: [notificationId],
    });

    if (!response.ok) {
      notificationState.notifications = previous;
      renderNotificationLists();
      setFeedback('notifications-feedback', 'error', 'Failed to mark as read. Your inbox state was restored.');
      return;
    }

    setFeedback('notifications-feedback', '', 'Marked as read.');
  } catch (_) {
    notificationState.notifications = previous;
    renderNotificationLists();
    setFeedback('notifications-feedback', 'error', 'Failed to mark as read. Your inbox state was restored.');
  }
}

async function handleMarkAllNotificationsRead() {
  if (!api || !api.notifications || !api.notifications.markAllRead) { return; }
  var btn = document.getElementById('notifications-mark-all-button');
  setButtonBusy(btn, true);

  var previous = cloneNotifications(notificationState.notifications);
  var changed = markLocalAllRead();
  if (changed) { renderNotificationLists(); }

  try {
    var response = await api.notifications.markAllRead({
      actorId: notificationState.actorId,
      actorRole: getActiveNotificationRole(),
    });

    if (!response.ok) {
      notificationState.notifications = previous;
      renderNotificationLists();
      setFeedback('notifications-feedback', 'error', 'Failed to mark all as read. Your inbox state was restored.');
      return;
    }

    setFeedback('notifications-feedback', '', 'Marked ' + response.data.updatedCount + ' as read.');
  } catch (_) {
    notificationState.notifications = previous;
    renderNotificationLists();
    setFeedback('notifications-feedback', 'error', 'Failed to mark all as read. Your inbox state was restored.');
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleRetryNotification(notificationId) {
  if (!api || !api.notifications || !api.notifications.retry) { return; }
  setFeedback('notifications-feedback', '', '');
  try {
    var response = await api.notifications.retry({
      actorId: notificationState.actorId,
      actorRole: getActiveNotificationRole(),
      notificationId: notificationId,
    });

    if (response.ok) {
      setFeedback('notifications-feedback', '', 'Retry dispatch queued.');
      await loadNotifications();
    } else {
      setFeedback('notifications-feedback', 'error', 'Retry failed: ' + (response.error ? response.error.message : 'Unknown error'));
    }
  } catch (err) {
    setFeedback('notifications-feedback', 'error', 'Retry error: ' + err.message);
  }
}

function wireNotificationFilterMenus() {
  if (!global.uiDropdownMenu || typeof global.uiDropdownMenu.wire !== 'function') {
    return;
  }
  if (notificationDropdownController && typeof notificationDropdownController.destroy === 'function') {
    notificationDropdownController.destroy();
  }
  notificationDropdownController = global.uiDropdownMenu.wire([
    { selectId: 'notifications-type-filter', triggerId: 'notifications-type-trigger', menuId: 'notifications-type-menu', labelId: 'notifications-type-label' },
    { selectId: 'notifications-severity-filter', triggerId: 'notifications-severity-trigger', menuId: 'notifications-severity-menu', labelId: 'notifications-severity-label' },
    { selectId: 'notifications-status-filter', triggerId: 'notifications-status-trigger', menuId: 'notifications-status-menu', labelId: 'notifications-status-label' },
  ], {
    rootSelector: '.ui-dropdown',
  });
}

function wireNotificationCenter() {
  if (typeof document.createElement !== 'function') { return; }
  var listContainer = document.getElementById('notifications-list');
  if (!listContainer) { return; }

  syncActiveRoleFromActor();
  syncRoleChip();
  maybeEmitRoleContractWarning();

  document.getElementById('notifications-load-button')?.addEventListener('click', function () { void loadNotifications(); });
  document.getElementById('notifications-mark-all-button')?.addEventListener('click', function () { void handleMarkAllNotificationsRead(); });
  ['notifications-type-filter', 'notifications-severity-filter', 'notifications-status-filter'].forEach(function (id) {
    document.getElementById(id)?.addEventListener('change', renderNotificationLists);
  });

  wireNotificationFilterMenus();
  renderNotificationLists();

  if (listContainer.classList && typeof listContainer.classList.remove === 'function') {
    void loadNotifications();
  }
}

global.wireNotificationCenter = wireNotificationCenter;
global.renderNotificationLists = renderNotificationLists;
global.canRetryNotification = canRetryNotification;
global.matchesNotificationFilters = matchesNotificationFilters;
global.isRoleVisibleNotification = isRoleVisibleNotification;
global.getNotificationFilters = getNotificationFilters;
global.buildNotificationLoadFeedback = buildNotificationLoadFeedback;
global.isBackendUnreachableError = isBackendUnreachableError;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
