const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('dashboard recent activity rows expose canonical deep-link payloads', () => {
  const dashboardPath = path.join(__dirname, '..', 'src', 'renderer', 'features', 'dashboard', 'views', 'dashboard-view.js');
  delete require.cache[dashboardPath];
  const viewDashboard = require(dashboardPath);

  const rows = viewDashboard.__test.buildRecentActivityRows([
    {
      submissionId: 'sub-draft',
      packName: 'Reopened Draft Pack',
      currentState: 'draft',
      updatedAt: '2026-03-06T10:00:00Z',
    },
    {
      submissionId: 'sub-reopened',
      packName: 'Recovered Reopened Pack',
      currentState: 'reopened',
      updatedAt: '2026-03-05T12:00:00Z',
    },
    {
      submissionId: 'sub-detail',
      packName: 'Approved Pack',
      currentState: 'approved',
      updatedAt: '2026-03-05T10:00:00Z',
    },
  ]);

  assert.match(rows, /data-nav="submissions"/);
  assert.match(rows, /data-submissions-shortcut="open-submission"/);
  assert.match(rows, /data-submission-id="sub-draft"/);
  assert.match(rows, /data-submissions-mode="draft"/);
  assert.match(rows, /aria-label="Resume draft submission Reopened Draft Pack"/);
  assert.match(rows, /data-submission-id="sub-reopened"/);
  assert.match(rows, /data-submissions-mode="draft"/);
  assert.match(rows, /aria-label="Resume draft submission Recovered Reopened Pack"/);
  assert.match(rows, /data-submission-id="sub-detail"/);
  assert.match(rows, /data-submissions-mode="detail"/);
  assert.match(rows, /aria-label="View submission details for Approved Pack"/);
  assert.match(rows, /Resume draft/);
  assert.match(rows, /View details/);
});

test('workspace shortcut payload normalization preserves target submission context', () => {
  const workspacePath = path.join(__dirname, '..', 'src', 'renderer', 'workspace', 'workspace-page.js');
  delete require.cache[workspacePath];
  const workspacePage = require(workspacePath);

  assert.deepEqual(
    workspacePage.__test.normalizeSubmissionsShortcutDetail({
      shortcut: 'open-submission',
      submissionId: 'sub-1',
      submissionMode: 'draft',
      sourceView: 'dashboard',
    }),
    {
      shortcut: 'open-submission',
      submissionId: 'sub-1',
      submissionMode: 'draft',
      sourceView: 'dashboard',
    },
  );

  assert.deepEqual(
    workspacePage.__test.normalizeSubmissionsShortcutDetail('history'),
    {
      shortcut: 'history',
      submissionId: '',
      submissionMode: '',
      sourceView: '',
    },
  );
});

test('workspace restores draft submissions into the wizard and detail submissions into timeline mode', () => {
  const workspacePath = path.join(__dirname, '..', 'src', 'renderer', 'workspace', 'workspace-page.js');
  delete require.cache[workspacePath];
  const workspacePage = require(workspacePath);

  assert.equal(
    workspacePage.__test.resolveSubmissionLaunchMode({ currentState: 'draft' }),
    'draft',
  );
  assert.equal(
    workspacePage.__test.resolveSubmissionLaunchMode({ currentState: 'rejected' }),
    'detail',
  );
  assert.equal(
    workspacePage.__test.resolveSubmissionLaunchMode({ currentState: 'approved' }),
    'detail',
  );
  assert.equal(
    workspacePage.__test.resolveSubmissionLaunchMode({ currentState: 'uploading' }),
    'draft',
  );

  assert.equal(
    workspacePage.__test.resolveDraftRestoreStep({ submissionId: 'sub-1' }),
    'airtable',
  );
  assert.equal(
    workspacePage.__test.resolveDraftRestoreStep(
      {
        submissionId: 'sub-2',
        airtableFormCompleted: true,
        airtablePayloadChecksum: 'checksum',
        airtableSyncStatus: 'linked',
      },
      { qcPassed: false },
    ),
    'intake',
  );
  assert.equal(
    workspacePage.__test.resolveDraftRestoreStep(
      {
        submissionId: 'sub-3',
        airtableFormCompleted: true,
        airtablePayloadChecksum: 'checksum',
        airtableSyncStatus: 'linked',
      },
      { qcPassed: true },
    ),
    'review',
  );
  assert.equal(
    workspacePage.__test.resolveDraftRestoreStep(
      {
        submissionId: 'sub-4',
        currentState: 'uploading',
        airtableFormCompleted: true,
        airtablePayloadChecksum: 'checksum',
        airtableSyncStatus: 'linked',
      },
      { qcPassed: false },
    ),
    'review',
  );
});
