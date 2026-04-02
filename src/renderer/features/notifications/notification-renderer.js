(function (global) {
  function mergeClassNames() {
    var seen = Object.create(null);
    var tokens = [];
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (!value) { continue; }
      String(value).split(/\s+/).forEach(function (token) {
        if (!token || seen[token]) { return; }
        seen[token] = true;
        tokens.push(token);
      });
    }
    return tokens.join(' ');
  }

  function formatNotificationLabel(value) {
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function notificationButtonFallback(tone) {
    var base = 'inline-flex items-center gap-2 rounded-brand-sm border px-3 py-1.5 text-xs font-semibold transition duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent';
    if (tone === 'danger') {
      return base + ' border-transparent bg-brand-danger text-white hover:brightness-95';
    }
    if (tone === 'ghost') {
      return base + ' border-transparent bg-transparent text-brand-text hover:bg-brand-surface-alt';
    }
    return base + ' border-brand-border bg-brand-surface text-brand-text hover:bg-brand-surface-alt';
  }

  function applyWrapperAttributes(el, attrs) {
    if (!el || !attrs) { return; }
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === undefined || value === null || value === false) { return; }
      el.setAttribute(key, value === true ? '' : String(value));
    });
  }

  function getFlowbiteWrappers() {
    if (typeof globalThis !== 'undefined' && globalThis.flowbiteWrappers) {
      return globalThis.flowbiteWrappers;
    }
    if (typeof window !== 'undefined' && window.flowbiteWrappers) {
      return window.flowbiteWrappers;
    }
    return null;
  }

  function decorateNotificationButton(button, options) {
    if (!button) { return; }
    var wrappers = getFlowbiteWrappers();
    var classes = [button.className || ''];
    if (wrappers && typeof wrappers.button === 'function') {
      var wrapper = wrappers.button(options || {});
      classes.push(wrapper.className || '');
      applyWrapperAttributes(button, wrapper.attrs);
    } else {
      classes.push((options && options.fallbackClass) || (options && options.className) || '');
    }
    button.className = mergeClassNames.apply(null, classes);
    button.setAttribute('type', 'button');
  }

  function getNotificationActionSubject(notification) {
    return notification.title || notification.notificationId || notification.id || 'this notification';
  }

  function getNotificationNextStep(notification, actorRole) {
    var type = String(notification.type || '').toLowerCase();

    if (type === 'qc_failed') {
      return 'Open Submissions and resolve all blocking QC findings.';
    }
    if (type === 'submitted' || type === 'under_review') {
      if (actorRole === 'creator') {
        return 'Track progress in Submission History.';
      }
      return 'Open Review Queue and record a decision.';
    }
    if (type === 'approved') {
      return actorRole === 'creator'
        ? 'Confirm release timing and watch for Scheduled/Released updates.'
        : 'Verify scheduling payload and monitor release health.';
    }
    if (type === 'rejected') {
      return actorRole === 'creator'
        ? 'Apply reviewer notes, rerun QC, and resubmit.'
        : 'Confirm rejection reason and amendment guidance.';
    }
    if (type === 'scheduled') {
      return 'Verify release date details and dependencies.';
    }
    if (type === 'released') {
      return actorRole === 'creator'
        ? 'Review post-release details and start the next submission.'
        : 'Confirm release completion and close follow-up tasks.';
    }
    return 'Open the linked workflow and complete the follow-up action.';
  }

  function getNotificationSvgIcon(severity, status, type) {
    var s = String(severity || '').toLowerCase();
    var st = String(status || '').toLowerCase();
    var t = String(type || '').toLowerCase();
    if (s === 'error' || st === 'failed') {
      return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>';
    }
    if (s === 'warning') {
      return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>';
    }
    if (st === 'sent' || t === 'approved') {
      return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd"/></svg>';
    }
    if (st === 'pending') {
      return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clip-rule="evenodd"/></svg>';
    }
    return '<svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 0 0-6 6v3.586l-.707.707A1 1 0 0 0 4 14h12a1 1 0 0 0 .707-1.707L16 11.586V8a6 6 0 0 0-6-6ZM10 18a3 3 0 0 1-3-3h6a3 3 0 0 1-3 3Z"/></svg>';
  }

  function getNotificationIconTheme(severity, status, type) {
    var s = String(severity || '').toLowerCase();
    var st = String(status || '').toLowerCase();
    var t = String(type || '').toLowerCase();
    if (s === 'error' || st === 'failed') { return 'bg-red-50 text-brand-danger border-brand-danger/20'; }
    if (s === 'warning') { return 'bg-amber-50 text-brand-accent border-brand-accent/30'; }
    if (st === 'sent' || t === 'approved') { return 'bg-green-50 text-green-600 border-green-200'; }
    if (st === 'pending') { return 'bg-brand-surface text-brand-text border-brand-border'; }
    return 'bg-brand-surface text-brand-text border-brand-border';
  }

  function createNotificationEmptyState(msg) {
    var card = document.createElement('div');
    card.className = 'notification-empty-state';
    card.setAttribute('data-testid', 'notification-empty-state');
    card.textContent = msg;
    return card;
  }

  function createNotificationCard(notification, actorRole, deps) {
    var isUnread = !notification.read;
    var notificationId = deps.getNotificationId(notification);
    var row = document.createElement('article');

    row.className = mergeClassNames('notification-card', isUnread ? 'notification-card-unread' : 'notification-card-read');
    row.setAttribute('data-notification-id', notificationId);
    row.setAttribute('data-notification-read', notification.read ? 'true' : 'false');

    var header = document.createElement('div');
    header.className = 'notification-card-header';

    var iconWrap = document.createElement('div');
    iconWrap.className = 'h-9 w-9 shrink-0 rounded-full flex items-center justify-center border ' + getNotificationIconTheme(notification.severity, notification.status, notification.type);
    iconWrap.innerHTML = getNotificationSvgIcon(notification.severity, notification.status, notification.type);
    header.appendChild(iconWrap);

    var titleWrap = document.createElement('div');
    titleWrap.className = 'min-w-0 flex-1';

    var titleRow = document.createElement('div');
    titleRow.className = 'notification-card-title-row';

    var title = document.createElement('p');
    title.className = mergeClassNames('notification-card-title', isUnread ? 'notification-card-title-unread' : 'notification-card-title-read');
    title.textContent = notification.title || notificationId || 'Notification';
    titleRow.appendChild(title);

    titleWrap.appendChild(titleRow);
    header.appendChild(titleWrap);

    var actions = document.createElement('div');
    actions.className = 'notification-actions notification-actions-inline';

    if (!notification.read) {
      var markBtn = document.createElement('button');
      markBtn.textContent = 'Mark Read';
      decorateNotificationButton(markBtn, {
        control: 'notification-mark-read',
        testId: 'notification-action-mark-read',
        tone: 'secondary',
        size: 'sm',
        className: 'gap-1',
        fallbackClass: notificationButtonFallback('secondary'),
      });
      markBtn.setAttribute('data-testid', 'notification-action-mark-read');
      markBtn.setAttribute('aria-label', 'Mark notification "' + getNotificationActionSubject(notification) + '" as read');
      markBtn.addEventListener('click', function () { deps.onMarkRead(notificationId); });
      actions.appendChild(markBtn);
    }

    if (deps.canRetryNotification(notification, actorRole)) {
      var retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry Sending';
      decorateNotificationButton(retryBtn, {
        control: 'notification-retry-dispatch',
        testId: 'notification-action-retry-dispatch',
        tone: 'danger',
        size: 'sm',
        className: 'gap-1',
        fallbackClass: notificationButtonFallback('danger'),
      });
      retryBtn.setAttribute('data-testid', 'notification-action-retry-dispatch');
      retryBtn.setAttribute('aria-label', 'Retry dispatch for notification "' + getNotificationActionSubject(notification) + '"');
      retryBtn.addEventListener('click', function () { deps.onRetry(notificationId); });
      actions.appendChild(retryBtn);
    }

    var meta = document.createElement('div');
    meta.className = 'notification-card-meta';

    var unreadChip = document.createElement('span');
    unreadChip.className = mergeClassNames('notification-unread-chip', isUnread ? '' : 'notification-meta-placeholder');
    unreadChip.textContent = 'Unread';
    meta.appendChild(unreadChip);

    if (notification.createdAt) {
      var date = document.createElement('time');
      date.className = 'notification-card-time';
      var d = new Date(notification.createdAt);
      date.textContent = isNaN(d) ? '' : d.toLocaleString();
      meta.appendChild(date);
    }

    if (actions.children.length > 0) {
      meta.appendChild(actions);
    } else {
      var actionPlaceholder = document.createElement('span');
      actionPlaceholder.className = 'notification-action-placeholder';
      actionPlaceholder.setAttribute('aria-hidden', 'true');
      meta.appendChild(actionPlaceholder);
    }

    if (meta.children.length > 0) {
      header.appendChild(meta);
    }

    row.appendChild(header);

    var tags = document.createElement('div');
    tags.className = 'notification-card-tags';
    [formatNotificationLabel(notification.type), formatNotificationLabel(notification.severity), formatNotificationLabel(notification.status)].forEach(function (label) {
      if (!label) { return; }
      var chip = document.createElement('span');
      chip.className = 'notification-chip';
      chip.textContent = label;
      tags.appendChild(chip);
    });
    if (tags.children.length > 0) { row.appendChild(tags); }

    if (notification.message) {
      var msg = document.createElement('p');
      msg.className = 'notification-card-message';
      msg.textContent = 'What changed: ' + notification.message;
      row.appendChild(msg);
    }

    var nextStep = document.createElement('p');
    nextStep.className = 'notification-card-next-step';
    nextStep.textContent = 'Next step: ' + getNotificationNextStep(notification, actorRole);
    row.appendChild(nextStep);

    return row;
  }

  global.notificationRenderer = {
    formatNotificationLabel: formatNotificationLabel,
    getNotificationActionSubject: getNotificationActionSubject,
    getNotificationNextStep: getNotificationNextStep,
    getNotificationSvgIcon: getNotificationSvgIcon,
    getNotificationIconTheme: getNotificationIconTheme,
    createNotificationEmptyState: createNotificationEmptyState,
    createNotificationCard: createNotificationCard,
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
