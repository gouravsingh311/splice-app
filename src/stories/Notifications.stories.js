import { renderTemplateStory } from './helpers/umd-loader';

function notificationCard({
  unread = true,
  retry = false,
  compact = false,
  title = 'Approved sub-degraded-notifs-1773768382866',
  message = 'What changed: Submission approved.',
  nextStep = 'Next step: Confirm release timing and watch for Scheduled/Released updates.',
}) {
  const unreadChip = unread
    ? '<span class="notification-unread-chip">Unread</span>'
    : '<span class="notification-unread-chip notification-meta-placeholder">Unread</span>';

  const markRead = unread
    ? '<div class="notification-actions notification-actions-inline"><button type="button" data-notification-action="mark-read" class="auth-button-secondary">Mark Read</button></div>'
    : '<span class="notification-action-placeholder" aria-hidden="true"></span>';

  const retryAction = retry
    ? '<div class="notification-actions notification-actions-inline"><button type="button" data-notification-action="retry" class="auth-button-secondary">Retry Sending</button></div>'
    : '';

  return `
    <div class="notification-list-shell ${unread ? 'notification-list-shell-unread' : 'notification-list-shell-read'}">
      <article class="notification-card ${unread ? 'notification-card-unread' : 'notification-card-read'}">
        <div class="notification-card-header">
          <div class="h-9 w-9 shrink-0 rounded-full flex items-center justify-center border bg-green-50 text-green-600 border-green-200">
            <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd"/></svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="notification-card-title-row">
              <p class="notification-card-title ${unread ? 'notification-card-title-unread' : 'notification-card-title-read'}">${title}</p>
            </div>
          </div>
          <div class="notification-card-meta">
            ${unreadChip}
            <time class="notification-card-time">3/17/2026, 10:56:27 PM</time>
            ${markRead}
          </div>
        </div>
        <div class="notification-card-tags">
          <span class="notification-chip">Approved</span>
          <span class="notification-chip">Info</span>
          <span class="notification-chip">Sent</span>
        </div>
        <p class="notification-card-message">${message}</p>
        ${compact ? '' : `<p class="notification-card-next-step">${nextStep}</p>`}
        ${retryAction}
      </article>
    </div>
  `;
}

function mountNotificationInteractions(root, { state, update }) {
  root.querySelector('[data-notification-action="mark-read"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    update({ unread: false });
  });
  root.querySelector('[data-notification-action="retry"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    update({ retryMessage: 'Retry simulated in Storybook (UI-only).' });
  });
  if (state.retryMessage) {
    const card = root.querySelector('.notification-card');
    if (card) {
      const feedback = document.createElement('p');
      feedback.className = 'auth-feedback mt-2';
      feedback.textContent = state.retryMessage;
      card.appendChild(feedback);
    }
  }
}

function renderNotification(args) {
  const state = {
    unread: args.unread,
    retry: args.retry,
    compact: args.compact,
    title: args.useLongTitle
      ? 'Approved submission degraded notifications for release-job-1773768382866 due to policy version mismatch requiring retry pipeline acknowledgment'
      : (args.retry ? 'Dispatch failed for notification dispatch job-0031' : 'Approved sub-degraded-notifs-1773768382866'),
    message: args.useFailureCopy
      ? 'What changed: Delivery did not complete.'
      : 'What changed: Submission approved.',
    nextStep: args.useFailureCopy
      ? 'Next step: Retry sending and verify dispatch status.'
      : 'Next step: Confirm release timing and watch for Scheduled/Released updates.',
  };
  return renderTemplateStory({
    scripts: [],
    globalsToReset: [],
    args: state,
    initialState: {
      ...state,
      retryMessage: '',
    },
    getTemplate: (_args, state) => notificationCard(state),
    mount: mountNotificationInteractions,
  });
}

export default {
  title: 'Notifications/Card',
  tags: ['autodocs'],
  argTypes: {
    unread: { control: { type: 'boolean' } },
    retry: { control: { type: 'boolean' } },
    compact: { control: { type: 'boolean' } },
    useLongTitle: { control: { type: 'boolean' } },
    useFailureCopy: { control: { type: 'boolean' } },
  },
};

export const Unread = {
  args: {
    unread: true,
    retry: false,
    compact: false,
    useLongTitle: false,
    useFailureCopy: false,
  },
  render: renderNotification,
};

export const Read = {
  args: {
    unread: false,
    retry: false,
    compact: false,
    useLongTitle: false,
    useFailureCopy: false,
  },
  render: renderNotification,
};

export const FailedWithRetry = {
  args: {
    unread: true,
    retry: true,
    compact: false,
    useLongTitle: false,
    useFailureCopy: true,
  },
  render: renderNotification,
};

export const UnreadLongTitle = {
  args: {
    unread: true,
    retry: false,
    compact: false,
    useLongTitle: true,
    useFailureCopy: false,
  },
  render: renderNotification,
};

export const FailedCompact = {
  args: {
    unread: true,
    retry: true,
    compact: true,
    useLongTitle: false,
    useFailureCopy: true,
  },
  render: renderNotification,
};

export const ReadCompact = {
  args: {
    unread: false,
    retry: false,
    compact: true,
    useLongTitle: false,
    useFailureCopy: false,
  },
  render: renderNotification,
};
