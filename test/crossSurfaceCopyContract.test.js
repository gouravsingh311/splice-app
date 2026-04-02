const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const workspacePage = require('../src/renderer/workspace/workspace-page.js');

test('workspace blocked and degraded copy includes explicit next steps', () => {
  const helpers = workspacePage.__test;

  const blocked = helpers.buildReadinessSummaryText({ canSubmit: false, blockers: [{}, {}] });
  assert.match(blocked, /Next step:/i);

  const blockedSubmit = helpers.buildSubmitBlockedFeedbackMessage({
    canSubmit: false,
    blockers: [
      { title: 'Metadata Required', message: 'm', nextAction: 'n' },
      { title: 'QC Must Pass', message: 'm', nextAction: 'n' },
    ],
  });
  assert.match(blockedSubmit, /Next step:/i);

  const qcSafe = helpers.toCreatorSafeSurfaceMessage('qc', 'QC_POLICY_VERSION_CONFLICT: expected_policy_version mismatch');
  assert.match(qcSafe, /Next step:/i);
  assert.doesNotMatch(qcSafe, /policy|ipc|api|backend/i);
});

test('workspace lifecycle messages include status change and next action for creator states', () => {
  const helpers = workspacePage.__test;
  const states = ['rejected', 'qc_failed', 'under_review', 'approved', 'scheduled', 'released'];

  states.forEach((state) => {
    const visibility = helpers.resolveLifecycleVisibility({ currentState: state }, [{ toState: state }]);
    assert.match(visibility.message, /Next step:/i);
  });
});

test('workspace source avoids technical jargon in creator status text', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'workspace', 'workspace-page.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /airtable_submission_links/);
});

test('notification copy contract defines explicit what changed and next steps', () => {
  const paths = [
    path.join(__dirname, '..', 'src', 'renderer.js'),
    path.join(__dirname, '..', 'src', 'renderer', 'features', 'qc', 'qc-admin.js'),
    path.join(__dirname, '..', 'src', 'renderer', 'features', 'notifications', 'notification-center.js'),
  ];
  const source = paths.map(p => fs.readFileSync(p, 'utf8')).join('\n');
  assert.match(source, /What changed:/);
  assert.match(source, /Next step:/);
  assert.match(source, /Retry Sending/);
});
