const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const reviewStep = require('../src/renderer/features/workspace/components/review-step.js');
const historyPanel = require('../src/renderer/features/workspace/components/history-panel.js');

test('review step renders the upload progress bar while the submission is uploading', () => {
  const markup = reviewStep.renderReviewStep({
    state: {
      isSubmitting: true,
      draft: {
        submissionId: 'sub-1',
      },
    },
    canSubmit: false,
    readiness: {
      canSubmit: false,
    },
    uploadState: {
      submissionId: 'sub-1',
      status: 'in_progress',
      progressPercent: 42,
      statusText: 'Uploading files to Dropbox',
      error: '',
    },
    escapeHtml: (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    buildReadinessSummaryText: () => 'Ready to submit',
    buildReadinessBlockersMarkup: () => '',
  });

  assert.match(markup, /workspace-upload-progress/);
  assert.match(markup, /Uploading files to Dropbox/);
  assert.match(markup, /42%/);
});

test('review step renders explicit resume control after upload failure', () => {
  const markup = reviewStep.renderReviewStep({
    state: {
      isSubmitting: false,
      uploadControlInFlight: '',
      draft: {
        submissionId: 'sub-1',
      },
    },
    canSubmit: false,
    readiness: {
      canSubmit: false,
    },
    uploadState: {
      submissionId: 'sub-1',
      status: 'failed',
      progressPercent: 38,
      statusText: 'Upload failed',
      error: 'Temporary Dropbox connectivity issue',
    },
    escapeHtml: (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    buildReadinessSummaryText: () => 'Submit blocked',
    buildReadinessBlockersMarkup: () => '',
  });

  assert.match(markup, /Resume Upload/);
  assert.doesNotMatch(markup, /Cancel Upload/);
  assert.match(markup, /Upload failed/);
});

test('review step hides canceled upload progress state', () => {
  const markup = reviewStep.renderReviewStep({
    state: {
      isSubmitting: false,
      uploadControlInFlight: '',
      draft: {
        submissionId: 'sub-1',
      },
    },
    canSubmit: true,
    readiness: {
      canSubmit: true,
    },
    uploadState: {
      submissionId: 'sub-1',
      status: 'canceled',
      progressPercent: 38,
      statusText: 'Upload canceled',
      error: 'Canceled by user',
    },
    escapeHtml: (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    buildReadinessSummaryText: () => 'Ready to submit',
    buildReadinessBlockersMarkup: () => '',
  });

  assert.doesNotMatch(markup, /workspace-upload-progress/);
  assert.match(markup, /Submit for Review/);
});

test('history panel surfaces upload progress for uploading submissions', () => {
  const markup = historyPanel.renderHistory({
    submissions: [
      {
        submissionId: 'sub-1',
        packName: 'Pack One',
        currentState: 'uploading',
        updatedAt: '2026-03-06T10:00:00.000Z',
        uploadStatus: 'in_progress',
        uploadProgressPercent: 42,
      },
    ],
    timelinesBySubmissionId: {
      'sub-1': [],
    },
    escapeHtml: (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
  });

  assert.match(markup, /Uploading files to Dropbox/);
  assert.match(markup, /42%/);
});

test('dashboard recent activity rows surface upload progress for uploading submissions', () => {
  const dashboardPath = path.join(
    __dirname,
    '..',
    'src',
    'renderer',
    'features',
    'dashboard',
    'views',
    'dashboard-view.js'
  );
  delete require.cache[dashboardPath];
  const viewDashboard = require(dashboardPath);

  const rows = viewDashboard.__test.buildRecentActivityRows([
    {
      submissionId: 'sub-1',
      packName: 'Pack One',
      currentState: 'uploading',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-06T10:00:00.000Z',
      uploadStatus: 'in_progress',
      uploadProgressPercent: 42,
    },
  ]);

  assert.match(rows, /Submitted Mar 1, 2026/);
  assert.doesNotMatch(rows, /Updated/);
  assert.match(rows, /Uploading files to Dropbox/);
  assert.match(rows, /42%/);
});
