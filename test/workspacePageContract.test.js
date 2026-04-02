const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspacePage = require('../src/renderer/workspace/workspace-page.js');

test('workspace template contains canonical wizard labels in submissions view', () => {
  const template = workspacePage.getTemplate();
  assert.match(template, /data-view="submissions"/);
  assert.match(template, /id="workspace-feedback"[^>]*role="status"/);
  assert.match(template, /id="workspace-feedback"[^>]*tabindex="-1"/);

  // Source may be spread across extracted components; scan all relevant sources
  const sourceFiles = [
    path.join(__dirname, '..', 'src', 'renderer', 'workspace', 'workspace-page.js'),
    path.join(__dirname, '..', 'src', 'renderer', 'features', 'workspace', 'components', 'airtable-step.js'),
    path.join(__dirname, '..', 'src', 'renderer', 'features', 'workspace', 'components', 'intake-step.js'),
    path.join(__dirname, '..', 'src', 'renderer', 'features', 'workspace', 'components', 'review-step.js'),
  ];
  const combinedSource = sourceFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.match(combinedSource, /Pack Metadata/);
  assert.match(combinedSource, /Pack Intake &amp; QC/);
  assert.match(combinedSource, /Review &amp; Submit/);
  assert.doesNotMatch(fs.readFileSync(sourceFiles[2], 'utf8'), /workspace-upload-progress/);
  assert.match(fs.readFileSync(sourceFiles[3], 'utf8'), /workspace-upload-progress/);
});
