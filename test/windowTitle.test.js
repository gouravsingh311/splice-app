const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWindowTitle, normalizeAppName } = require("../src/renderer/core/utils/window-title.js");

test("normalizeAppName formats kebab-case names", () => {
  assert.equal(normalizeAppName("splice-app"), "Splice App");
});

test("buildWindowTitle applies desktop suffix", () => {
  assert.equal(buildWindowTitle("splice-app"), "Splice App Desktop");
});
