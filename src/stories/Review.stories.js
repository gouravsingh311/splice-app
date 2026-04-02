import { renderTemplateStory } from './helpers/umd-loader';

function queueItem({ isLowRisk = false, isStale = false, isApproved = false, longTitle = false, useOpenLabel = true }) {
  const risk = isLowRisk ? 'low' : 'high';
  const age = isStale ? '3d' : (isLowRisk ? '14m' : '2h');
  const state = isApproved ? 'approved' : 'under_review';
  const actionLabel = useOpenLabel ? 'Open' : 'Review';
  const title = longTitle
    ? 'sub-review-001 • Night Textures Pack with policy mismatch and incomplete metadata requiring explicit operator attention'
    : 'sub-review-001 • Night Textures Pack';
  return `
    <div class="fe-card">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="fe-card-title">${title}</h3>
          <p class="auth-subtle mt-1">Flags: policy, audio_zip_naming • Tags: edm, vocal</p>
        </div>
        <span class="fe-status-chip ${state.replace('_', '-')}">${state.replace('_', ' ')}</span>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="notification-chip">Risk: ${risk}</span>
        <span class="notification-chip">Age: ${age}</span>
        <button type="button" data-review-action="open" class="auth-button-secondary">${actionLabel}</button>
      </div>
    </div>
  `;
}

function decisionPanel({ mode = 'approve', compact = false, feedback = '' }) {
  const isReject = mode === 'reject';
  return `
    <div class="fe-card">
      <h3 class="fe-card-title">Reviewer Decision</h3>
      <p class="auth-subtle mt-2">Use approve, reject, or reopen with explicit reasoning.</p>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        <button type="button" data-review-action="approve" class="auth-button">Approve</button>
        <button type="button" data-review-action="reopen" class="auth-button-secondary">Re-open</button>
      </div>
      <div class="mt-4 rounded-brand-sm border border-brand-border/50 bg-brand-surface p-3">
        <p class="fe-label">Reject reason</p>
        <select class="auth-input mt-1">
          <option ${isReject ? 'selected' : ''}>MISSING_ASSETS</option>
          <option>QC_BLOCKERS</option>
          <option>POLICY_MISMATCH</option>
        </select>
        <p class="fe-label mt-3">Reviewer notes</p>
        <textarea class="auth-input ${compact ? 'min-h-16' : 'min-h-24'} mt-1">${isReject ? 'Please fix missing assets and rerun QC before resubmitting.' : ''}</textarea>
      </div>
      ${feedback ? `<p class="auth-feedback mt-3">${feedback}</p>` : ''}
    </div>
  `;
}

function mountQueueInteractions(root) {
  root.querySelector('[data-review-action="open"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    const host = root.querySelector('.fe-card');
    if (host && !host.querySelector('[data-review-feedback]')) {
      const feedback = document.createElement('p');
      feedback.dataset.reviewFeedback = 'true';
      feedback.className = 'auth-feedback mt-3';
      feedback.textContent = 'Queue action simulated in Storybook (UI-only).';
      host.appendChild(feedback);
    }
  });
}

function mountDecisionInteractions(root, { update }) {
  root.querySelector('[data-review-action="approve"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    update({ feedback: 'Approve simulated in Storybook (UI-only).' });
  });
  root.querySelector('[data-review-action="reopen"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    update({ feedback: 'Re-open simulated in Storybook (UI-only).' });
  });
}

function renderQueueStory(args) {
  return renderTemplateStory({
    scripts: [],
    globalsToReset: [],
    args,
    getTemplate: () => queueItem(args),
    mount: mountQueueInteractions,
  });
}

function renderDecisionStory(args) {
  return renderTemplateStory({
    scripts: [],
    globalsToReset: [],
    args,
    initialState: { ...args, feedback: '' },
    getTemplate: (_args, state) => decisionPanel(state),
    mount: mountDecisionInteractions,
  });
}

export default {
  title: 'Review/Console',
  tags: ['autodocs'],
};

export const QueueItem = {
  args: { isLowRisk: false, isStale: false, isApproved: false, longTitle: false, useOpenLabel: true },
  argTypes: {
    isLowRisk: { control: { type: 'boolean' } },
    isStale: { control: { type: 'boolean' } },
    isApproved: { control: { type: 'boolean' } },
    longTitle: { control: { type: 'boolean' } },
    useOpenLabel: { control: { type: 'boolean' } },
  },
  render: renderQueueStory,
};

export const QueueItemLowRisk = {
  args: { isLowRisk: true, isStale: false, isApproved: false, longTitle: false, useOpenLabel: true },
  render: renderQueueStory,
};

export const QueueItemLongTitle = {
  args: { isLowRisk: false, isStale: false, isApproved: false, longTitle: true, useOpenLabel: true },
  render: renderQueueStory,
};

export const QueueItemStale = {
  args: { isLowRisk: false, isStale: true, isApproved: false, longTitle: false, useOpenLabel: true },
  render: renderQueueStory,
};

export const DecisionApprove = {
  args: { isReject: false, compact: false },
  argTypes: {
    isReject: { control: { type: 'boolean' } },
    compact: { control: { type: 'boolean' } },
  },
  render: (args) => renderDecisionStory({ ...args, mode: args.isReject ? 'reject' : 'approve' }),
};

export const DecisionReject = {
  args: { isReject: true, compact: false },
  render: (args) => renderDecisionStory({ ...args, mode: args.isReject ? 'reject' : 'approve' }),
};

export const DecisionRejectCompact = {
  args: { isReject: true, compact: true },
  render: (args) => renderDecisionStory({ ...args, mode: args.isReject ? 'reject' : 'approve' }),
};
