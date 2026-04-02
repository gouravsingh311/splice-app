import flowbiteWrappersScript from '../renderer/ui/flowbite-wrappers.js?raw';
import authViewScript from '../renderer/features/auth/views/auth-view.js?raw';
import dashboardViewScript from '../renderer/features/dashboard/views/dashboard-view.js?raw';
import notificationsViewScript from '../renderer/features/notifications/views/notifications-view.js?raw';
import adminPageScript from '../renderer/features/admin/admin-page.js?raw';
import adminViewScript from '../renderer/features/admin/views/admin-ops-view.js?raw';
import settingsViewScript from '../renderer/features/settings/views/settings-view.js?raw';
import workspacePageScript from '../renderer/workspace/workspace-page.js?raw';
import workspacePackStructureScript from '../renderer/workspace/pack-structure.js?raw';
import workspaceWorkflowGatesScript from '../renderer/workspace/workflow-gates.js?raw';
import workspaceQcFindingsScript from '../renderer/features/workspace/utils/qc-findings.js?raw';
import workspaceMarkupScript from '../renderer/features/workspace/utils/markup.js?raw';
import workspaceReadinessScript from '../renderer/features/workspace/utils/readiness.js?raw';
import workspaceWizardNavScript from '../renderer/features/workspace/components/wizard-nav.js?raw';
import workspaceAirtableStepScript from '../renderer/features/workspace/components/airtable-step.js?raw';
import workspaceIntakeStepScript from '../renderer/features/workspace/components/intake-step.js?raw';
import workspaceReviewStepScript from '../renderer/features/workspace/components/review-step.js?raw';
import workspaceSubmissionDetailScript from '../renderer/features/workspace/components/submission-detail.js?raw';
import workspaceHistoryPanelScript from '../renderer/features/workspace/components/history-panel.js?raw';
import workspaceStateScript from '../renderer/features/workspace/services/state.js?raw';
import submissionsViewScript from '../renderer/features/workspace/views/submissions-view.js?raw';
import reviewStoreScript from '../renderer/features/review/review-store.js?raw';
import reviewPageUtilsScript from '../renderer/features/review/review-page-utils.js?raw';
import reviewQueueStateScript from '../renderer/features/review/review-queue-state.js?raw';
import reviewQueueRenderScript from '../renderer/features/review/review-queue-render.js?raw';
import reviewQueueActionsScript from '../renderer/features/review/review-queue-actions.js?raw';
import reviewDetailRenderScript from '../renderer/features/review/review-detail-render.js?raw';
import reviewDetailActionsScript from '../renderer/features/review/review-detail-actions.js?raw';
import reviewQueuePageScript from '../renderer/features/review/review-queue-page.js?raw';
import reviewQueueViewScript from '../renderer/features/review/views/reviewer-queue-view.js?raw';
import reviewDetailPageScript from '../renderer/features/review/review-detail-page.js?raw';
import reviewDecisionViewScript from '../renderer/features/review/views/reviewer-decision-view.js?raw';

import { renderTemplateStory } from './helpers/umd-loader';

const baseScripts = [flowbiteWrappersScript];

function setAuthTab(root, tabName) {
  root.querySelectorAll('[data-auth-tab]').forEach((el) => {
    const isActive = el.dataset.authTab === tabName;
    el.classList.toggle('active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  root.querySelectorAll('[data-auth-view]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.authView !== tabName);
  });
}

function setAuthRole(root, roleName) {
  const roleInput = root.querySelector('#register-role');
  const roleLabel = root.querySelector('#register-role-label');
  if (roleInput) roleInput.value = roleName;
  if (roleLabel) roleLabel.textContent = roleName.slice(0, 1).toUpperCase() + roleName.slice(1);
  root.querySelectorAll('#register-role-menu .auth-role-option').forEach((opt) => {
    opt.classList.toggle('active', opt.dataset.roleValue === roleName);
  });
}

function mountAuthInteractions(root, { state }) {
  const currentTab = state.isForgot ? 'forgot' : (state.isRegister ? 'register' : 'login');
  const currentRole = state.isAdmin ? 'admin' : (state.isReviewer ? 'reviewer' : 'creator');
  setAuthTab(root, currentTab);
  setAuthRole(root, currentRole);

  root.querySelectorAll('[data-auth-tab]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      setAuthTab(root, el.dataset.authTab);
    });
  });

  const roleButton = root.querySelector('#register-role-button');
  const roleMenu = root.querySelector('#register-role-menu');
  if (roleButton && roleMenu) {
    roleButton.addEventListener('click', (event) => {
      event.preventDefault();
      const shouldOpen = roleMenu.classList.contains('hidden');
      roleMenu.classList.toggle('hidden', !shouldOpen);
      roleButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    });
    roleMenu.querySelectorAll('[data-role-value]').forEach((option) => {
      option.addEventListener('click', (event) => {
        event.preventDefault();
        setAuthRole(root, option.dataset.roleValue);
        roleMenu.classList.add('hidden');
        roleButton.setAttribute('aria-expanded', 'false');
      });
    });
  }

  const clickFeedbackMap = [
    ['[data-ui-control="auth-login-submit"]', '#login-feedback', 'Login simulated in Storybook (UI-only).'],
    ['#register-send-otp', '#register-otp-status', 'OTP send simulated in Storybook.'],
    ['#register-verify-otp', '#register-otp-status', 'OTP verify simulated in Storybook.'],
    ['[data-ui-control="auth-register-submit"]', '#register-feedback', 'Create account simulated in Storybook (UI-only).'],
    ['#forgot-send-otp', '#forgot-otp-status', 'Reset OTP send simulated in Storybook.'],
    ['#forgot-verify-otp', '#forgot-otp-status', 'Reset OTP verify simulated in Storybook.'],
    ['[data-ui-control="auth-forgot-submit"]', '#forgot-feedback', 'Password reset simulated in Storybook (UI-only).'],
  ];
  clickFeedbackMap.forEach(([buttonSelector, feedbackSelector, text]) => {
    const button = root.querySelector(buttonSelector);
    const feedback = root.querySelector(feedbackSelector);
    if (button && feedback) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        feedback.textContent = text;
        feedback.classList.remove('hidden');
      });
    }
  });
}

function mountNotificationsInteractions(root, { state }) {
  const menuSpecs = [
    { key: 'openTypeMenu', trigger: '#notifications-type-trigger', menu: '#notifications-type-menu' },
    { key: 'openSeverityMenu', trigger: '#notifications-severity-trigger', menu: '#notifications-severity-menu' },
    { key: 'openStatusMenu', trigger: '#notifications-status-trigger', menu: '#notifications-status-menu' },
  ];

  menuSpecs.forEach((spec) => {
    const triggerEl = root.querySelector(spec.trigger);
    const menuEl = root.querySelector(spec.menu);
    const rootEl = triggerEl?.closest('.ui-dropdown');
    const isOpen = Boolean(state[spec.key]);
    if (!triggerEl || !menuEl) { return; }
    menuEl.classList.toggle('hidden', !isOpen);
    triggerEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (rootEl) { rootEl.classList.toggle('is-open', isOpen); }
  });
}

function buildSubmissionsStoryBridge(state) {
  const actorId = 'desktop-local';
  const baseSubmission = {
    submissionId: 'sub-001',
    packName: 'Night Textures',
    currentState: 'under_review',
    releaseMonth: '2026-05',
    notes: 'Needs reviewer confirmation',
    tags: ['edm', 'vocal'],
    updatedAt: '2026-03-18T10:56:27Z',
  };
  const rejectedSubmission = {
    submissionId: 'sub-002',
    packName: 'Skyline Vox',
    currentState: 'rejected',
    releaseMonth: '2026-05',
    notes: 'Missing assets',
    tags: ['house'],
    updatedAt: '2026-03-17T09:10:00Z',
  };

  const submissions = state.seedWithData
    ? [baseSubmission, ...(state.includeRejected ? [rejectedSubmission] : [])]
    : [];

  return {
    creator: {
      profile: {
        get: async () => ({
          ok: true,
          data: {
            userId: actorId,
            labelName: 'File Eaters',
          },
        }),
      },
    },
    submissions: {
      list: async () => ({
        ok: true,
        data: { submissions },
      }),
      timeline: async ({ submissionId }) => ({
        ok: true,
        data: {
          timeline: submissionId === 'sub-002'
            ? [{ toState: 'rejected', reason: 'missing_assets', createdAt: '2026-03-17T09:10:00Z' }]
            : [{ toState: 'under_review', reason: 'submitted', createdAt: '2026-03-18T10:56:27Z' }],
        },
      }),
      draft: async () => ({ ok: true, data: { submissionId: 'sub-draft-001' } }),
      metadata: async () => ({ ok: true, data: {} }),
      airtableSync: async () => ({ ok: true, data: { syncStatus: 'linked' } }),
      airtableReset: async () => ({ ok: true, data: { syncStatus: 'pending' } }),
      intakeStart: async () => ({ ok: true, data: { sessionId: 'intake-1' } }),
      intakeManifest: async () => ({ ok: true, data: {} }),
      intakeHandoff: async () => ({ ok: true, data: {} }),
      intakeLock: async () => ({ ok: true, data: {} }),
      transition: async () => ({ ok: true, data: {} }),
    },
  };
}

function mountSubmissionsStory(root, { state }) {
  const existingBridge = globalThis.electronAPI || globalThis.splice || null;
  globalThis.electronAPI = buildSubmissionsStoryBridge(state);

  let attempts = 0;
  const maxAttempts = 20;

  function tryWire() {
    attempts += 1;
    if (!root || !root.isConnected) {
      if (attempts < maxAttempts) {
        setTimeout(tryWire, 16);
      }
      return;
    }
    if (globalThis.viewSubmissions && typeof globalThis.viewSubmissions.wire === 'function') {
      globalThis.viewSubmissions.wire();
      if (state.openDraft) {
        setTimeout(() => {
          root.querySelector('[data-workspace-create]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }, 40);
      }
      if (state.triggerNeedsActionShortcut) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('splice:submissions-shortcut', { detail: { shortcut: 'needs-action' } }));
        }, 60);
      }
    }
  }

  setTimeout(tryWire, 0);

  return () => {
    if (existingBridge) {
      globalThis.electronAPI = existingBridge;
    }
  };
}

export default {
  title: 'App/Pages',
  tags: ['autodocs'],
};

export const Auth = {
  args: {
    isRegister: false,
    isForgot: false,
    isReviewer: false,
    isAdmin: false,
  },
  argTypes: {
    isRegister: { control: { type: 'boolean' } },
    isForgot: { control: { type: 'boolean' } },
    isReviewer: { control: { type: 'boolean' } },
    isAdmin: { control: { type: 'boolean' } },
  },
  render: (args) => renderTemplateStory({
    scripts: [...baseScripts, authViewScript],
    globalsToReset: ['viewAuth'],
    args,
    getTemplate: () => globalThis.viewAuth.getTemplate(),
    mount: mountAuthInteractions,
  }),
};

export const Dashboard = {
  render: () => renderTemplateStory({
    scripts: [...baseScripts, dashboardViewScript],
    globalsToReset: ['viewDashboard'],
    getTemplate: () => globalThis.viewDashboard.getTemplate(),
  }),
};

export const Notifications = {
  args: {
    openTypeMenu: false,
    openSeverityMenu: false,
    openStatusMenu: false,
  },
  argTypes: {
    openTypeMenu: { control: { type: 'boolean' } },
    openSeverityMenu: { control: { type: 'boolean' } },
    openStatusMenu: { control: { type: 'boolean' } },
  },
  render: (args) => renderTemplateStory({
    scripts: [...baseScripts, notificationsViewScript],
    globalsToReset: ['viewNotifications'],
    args,
    getTemplate: () => globalThis.viewNotifications.getTemplate(),
    mount: mountNotificationsInteractions,
  }),
};

export const Submissions = {
  args: {
    seedWithData: true,
    includeRejected: true,
    openDraft: false,
    triggerNeedsActionShortcut: false,
  },
  argTypes: {
    seedWithData: { control: { type: 'boolean' } },
    includeRejected: { control: { type: 'boolean' } },
    openDraft: { control: { type: 'boolean' } },
    triggerNeedsActionShortcut: { control: { type: 'boolean' } },
  },
  render: (args) => renderTemplateStory({
    scripts: [
      ...baseScripts,
      workspacePackStructureScript,
      workspaceWorkflowGatesScript,
      workspaceQcFindingsScript,
      workspaceMarkupScript,
      workspaceReadinessScript,
      workspaceWizardNavScript,
      workspaceAirtableStepScript,
      workspaceIntakeStepScript,
      workspaceReviewStepScript,
      workspaceSubmissionDetailScript,
      workspaceHistoryPanelScript,
      workspaceStateScript,
      workspacePageScript,
      submissionsViewScript,
    ],
    globalsToReset: ['creatorWorkspacePage', 'viewSubmissions'],
    args,
    getTemplate: () => globalThis.viewSubmissions.getTemplate(),
    mount: mountSubmissionsStory,
  }),
};

export const ReviewerQueue = {
  render: () => renderTemplateStory({
    scripts: [
      ...baseScripts,
      reviewStoreScript,
      reviewPageUtilsScript,
      reviewQueueStateScript,
      reviewQueueRenderScript,
      reviewQueueActionsScript,
      reviewQueuePageScript,
      reviewQueueViewScript,
    ],
    globalsToReset: ['reviewConsoleStore', 'reviewQueuePage', 'viewReviewerQueue'],
    getTemplate: () => globalThis.viewReviewerQueue.getTemplate(),
  }),
};

export const ReviewerDecision = {
  render: () => renderTemplateStory({
    scripts: [
      ...baseScripts,
      reviewStoreScript,
      reviewPageUtilsScript,
      reviewDetailRenderScript,
      reviewDetailActionsScript,
      reviewDetailPageScript,
      reviewDecisionViewScript,
    ],
    globalsToReset: ['reviewConsoleStore', 'reviewDetailPage', 'viewReviewerDecision'],
    getTemplate: () => globalThis.viewReviewerDecision.getTemplate(),
  }),
};

export const AdminOps = {
  render: () => renderTemplateStory({
    scripts: [...baseScripts, adminPageScript, adminViewScript],
    globalsToReset: ['adminPage', 'viewAdminOps'],
    getTemplate: () => globalThis.viewAdminOps.getTemplate(),
  }),
};

export const Settings = {
  render: () => renderTemplateStory({
    scripts: [...baseScripts, settingsViewScript],
    globalsToReset: ['viewSettings'],
    getTemplate: () => globalThis.viewSettings.getTemplate(),
  }),
};
