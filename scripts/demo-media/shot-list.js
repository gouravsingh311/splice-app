const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const MEDIA_ROOT = path.join(ROOT_DIR, 'docs', 'reports', 'assets', 'demo-media');

const OUTPUT_DIRS = Object.freeze({
  mediaRoot: MEDIA_ROOT,
  masters: path.join(MEDIA_ROOT, 'videos', 'masters'),
  silentVideos: path.join(MEDIA_ROOT, 'videos', 'silent'),
  voiceoverVideos: path.join(MEDIA_ROOT, 'videos', 'voiceover'),
  screenshots: path.join(MEDIA_ROOT, 'screenshots'),
  tmp: path.join(MEDIA_ROOT, '.tmp'),
});

const DEFAULT_LOGIN = Object.freeze({
  email: 'demo-user@fileeaters.local',
  password: 'Password123456!',
});

const FLOWS = Object.freeze([
  {
    role: 'creator',
    flow: 'workspace-walkthrough',
    actorId: 'demo-creator',
    actorRoles: 'creator',
    narrationText:
      'Creators begin on dashboard, move to submissions workspace, open notifications, and verify account settings before submitting packs.',
    steps: [
      {
        id: 'dashboard-home',
        nav: 'dashboard',
        expect: '#view-dashboard',
        caption: 'Start on Dashboard to review current submission status.',
        holdMs: 2600,
      },
      {
        id: 'submissions-workspace',
        nav: 'submissions',
        expect: '#view-submissions',
        caption: 'Open Submissions to prepare and validate the next pack.',
        holdMs: 2800,
      },
      {
        id: 'notifications-inbox',
        nav: 'notifications',
        expect: '#view-notifications',
        caption: 'Check Notifications for reviewer updates and required actions.',
        holdMs: 2600,
        action: { type: 'click', selector: '#notifications-load-button' },
      },
      {
        id: 'settings-review',
        nav: 'settings',
        expect: '#view-settings',
        caption: 'Confirm account and workspace settings before final submission.',
        holdMs: 2400,
      },
    ],
  },
  {
    role: 'reviewer',
    flow: 'review-operations',
    actorId: 'demo-reviewer',
    actorRoles: 'reviewer',
    narrationText:
      'Reviewers triage queue items, inspect decision context, and monitor notifications to keep submissions moving.',
    steps: [
      {
        id: 'queue-triage',
        nav: 'reviewer-queue',
        expect: '#view-reviewer-queue',
        caption: 'Review Queue surfaces pending packs and prioritization signals.',
        holdMs: 2800,
      },
      {
        id: 'decision-panel',
        nav: 'reviewer-decision',
        expect: '#view-reviewer-decision',
        caption: 'Reviewer Decision captures approval or rejection outcomes.',
        holdMs: 2800,
      },
      {
        id: 'notifications-followup',
        nav: 'notifications',
        expect: '#view-notifications',
        caption: 'Use Notifications to track retries, follow-ups, and handoffs.',
        holdMs: 2600,
        action: { type: 'click', selector: '#notifications-load-button' },
      },
    ],
  },
  {
    role: 'admin',
    flow: 'admin-ops-control',
    actorId: 'demo-admin',
    actorRoles: 'admin,reviewer,creator',
    narrationText:
      'Admins validate operational controls, monitor dashboard health, and confirm settings for secure desktop operations.',
    steps: [
      {
        id: 'admin-ops',
        nav: 'admin-ops',
        expect: '#view-admin-ops',
        caption: 'Admin Ops centralizes policy and operational control actions.',
        holdMs: 3000,
      },
      {
        id: 'dashboard-overview',
        nav: 'dashboard',
        expect: '#view-dashboard',
        caption: 'Dashboard confirms current state across submissions and queue load.',
        holdMs: 2500,
      },
      {
        id: 'notifications-audit',
        nav: 'notifications',
        expect: '#view-notifications',
        caption: 'Notifications help audit critical events and escalation signals.',
        holdMs: 2600,
        action: { type: 'click', selector: '#notifications-load-button' },
      },
      {
        id: 'settings-governance',
        nav: 'settings',
        expect: '#view-settings',
        caption: 'Settings provide final governance checks for desktop environment.',
        holdMs: 2400,
      },
    ],
  },
]);

function flowSlug(flow) {
  return `${flow.role}-${flow.flow}`;
}

function screenshotName(flow, step) {
  return `${flow.role}-${flow.flow}-${step.id}.png`;
}

function masterVideoName(flow) {
  return `${flow.role}-${flow.flow}-master.mp4`;
}

function finalVideoName(flow, variant) {
  return `${flow.role}-${flow.flow}-${variant}.mp4`;
}

module.exports = {
  DEFAULT_LOGIN,
  FLOWS,
  OUTPUT_DIRS,
  flowSlug,
  screenshotName,
  masterVideoName,
  finalVideoName,
};
