const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('shell navigation keeps creator parity labels while preserving canonical route authority', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.equal(html.includes('data-nav="dashboard"'), true);
  assert.equal(html.includes('data-nav="submissions"'), true);
  assert.equal(html.includes('data-nav="notifications"'), true);
  assert.equal(html.includes('data-nav="settings"'), true);
  assert.equal(html.includes('id="sidebar-primary-nav"'), true);
  assert.equal(html.includes('aria-label="Primary workspace navigation"'), true);
  assert.equal(html.includes('data-testid="nav-dashboard"'), true);
  assert.equal(html.includes('data-testid="nav-notifications"'), true);
  assert.equal(html.includes('Submissions'), true);
  assert.equal(html.includes('data-testid="nav-submissions"'), true);

  assert.equal(html.includes('data-nav="upload-qc"'), false);
  assert.equal(html.includes('data-nav="qc-results"'), false);
  assert.equal(html.includes('id="notif-unread-badge"'), true);
  assert.equal(html.includes('data-testid="notifications-unread-badge"'), true);
  assert.equal(html.includes('aria-live="polite"'), true);
});
