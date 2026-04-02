const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("admin ops policy UI exposes structured policy fields", () => {
  const adminPagePath = path.join(__dirname, "..", "src", "renderer", "features", "admin", "admin-page.js");
  delete require.cache[adminPagePath];
  const adminPage = require(adminPagePath);

  const template = adminPage.getTemplate();
  assert.equal(template.includes('id="admin-policy-id-input"'), true);
  assert.equal(template.includes('id="admin-policy-ruleset-input"'), true);
  assert.equal(template.includes('id="admin-policy-reason-input"'), true);
  assert.equal(template.includes('id="admin-policy-normalization-target-input"'), true);
  assert.equal(template.includes('id="admin-policy-normalization-tolerance-input"'), true);
  assert.equal(template.includes('id="admin-policy-normalization-strict-input"'), true);
  assert.equal(template.includes('id="admin-tab-compliance"'), true);
  assert.equal(template.includes('id="admin-compliance-action"'), true);
  assert.equal(template.includes('id="admin-compliance-entity-id"'), true);
  assert.equal(template.includes('id="admin-compliance-refresh"'), true);
  assert.equal(template.includes('id="admin-compliance-export"'), true);
  assert.equal(template.includes('id="admin-compliance-events-body"'), true);
  assert.equal(template.includes("Policy JSON"), false);
});
