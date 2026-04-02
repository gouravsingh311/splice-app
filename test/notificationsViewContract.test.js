const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("notifications view template preserves grouped unread/read list contract IDs", () => {
  const viewPath = path.join(__dirname, "..", "src", "renderer", "features", "notifications", "views", "notifications-view.js");
  delete require.cache[viewPath];
  const viewNotifications = require(viewPath);

  const template = viewNotifications.getTemplate();
  assert.equal(template.includes('id="notifications-list"'), true);
  assert.equal(template.includes('id="notifications-unread-list"'), true);
  assert.equal(template.includes('id="notifications-read-list"'), true);
  assert.equal(template.includes('id="notifications-unread-count"'), true);
  assert.equal(template.includes('id="notifications-read-count"'), true);
  assert.equal(template.includes('id="notifications-total-count"'), true);
  assert.equal(template.includes('id="notifications-next-step-guidance"'), true);
  assert.equal(template.includes('data-testid="notifications-list"'), true);
  assert.equal(template.includes('data-testid="notifications-load-button"'), true);
  assert.equal(template.includes('data-testid="notifications-mark-all-button"'), true);
  assert.equal(template.includes('data-testid="notifications-role-chip"'), true);
  assert.equal(template.includes('data-testid="notifications-active-role"'), true);
  assert.equal(template.includes('notifications-role-filter'), false);
  assert.equal(template.includes('aria-label="Mark all unread notifications as read"'), true);
  assert.equal(template.includes('aria-label="Refresh notifications"'), true);
});
