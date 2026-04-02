const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('dashboard template preserves creator-safe parity structure and canonical submissions routing', () => {
  const dashboardPath = path.join(__dirname, "..", "src", "renderer", "features", "dashboard", "views", "dashboard-view.js");
  delete require.cache[dashboardPath];
  const viewDashboard = require(dashboardPath);

  const template = viewDashboard.getTemplate();
  assert.equal(template.includes('Dashboard'), true);
  assert.equal(template.includes('Total'), true);
  assert.equal(template.includes('Under Review'), true);
  assert.equal(template.includes('Approved'), true);
  assert.equal(template.includes('QC Failed'), true);
  assert.equal(template.includes('Start New Pack Submission'), true);
  assert.equal(template.includes('Recent Activity'), true);
  assert.equal(template.includes('View All History'), true);
  assert.equal(template.includes('Create New Pack'), true);
  assert.equal(template.includes('Retry Dashboard Data'), true);
  assert.equal(template.includes('dashboard-submissions-status'), true);
  assert.equal(template.includes('data-nav="submissions"'), true);
  assert.equal(template.includes('data-nav="notifications"'), true);
  assert.equal(template.includes('data-submissions-shortcut="create"'), true);
  assert.equal(template.includes('data-submissions-shortcut="history"'), true);
  assert.equal(template.includes('data-nav="upload-qc"'), false);
});

test('settings template renders creator-safe account and preference content', () => {
  const settingsPath = path.join(__dirname, "..", "src", "renderer", "features", "settings", "views", "settings-view.js");
  delete require.cache[settingsPath];
  const viewSettings = require(settingsPath);

  const template = viewSettings.getTemplate();
  assert.equal(template.includes('Creator Settings'), true);
  assert.equal(template.includes('Notification Preferences'), true);
  assert.equal(template.includes('Preview only. These preferences mirror the creator-safe layout, but this screen does not persist edits yet.'), true);
  assert.equal((template.match(/disabled aria-disabled="true"/g) || []).length, 4);

  assert.equal(template.includes('Desktop Security'), false);
  assert.equal(template.includes('Run Security Check'), false);
  assert.equal(template.includes('Audit Events'), false);
  assert.equal(template.includes('id="environment-name"'), false);
  assert.equal(template.includes('id="health-port"'), false);
  assert.equal(template.includes('id="electron-version"'), false);
  assert.equal(template.includes('id="chrome-version"'), false);
  assert.equal(template.includes('Save Preferences'), false);
});

test('workspace copy avoids internal Airtable table names in creator status text', () => {
  const workspacePath = path.join(__dirname, '..', 'src', 'renderer', 'workspace', 'workspace-page.js');
  const airtableStepPath = path.join(__dirname, '..', 'src', 'renderer', 'features', 'workspace', 'components', 'airtable-step.js');
  const fs = require('node:fs');
  const source = fs.readFileSync(workspacePath, 'utf8') + '\n' + fs.readFileSync(airtableStepPath, 'utf8');

  assert.equal(source.includes('linked through airtable_submission_links'), false);
  assert.equal(source.includes('Airtable linked and confirmed for this submission'), true);
});
