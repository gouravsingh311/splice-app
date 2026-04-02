const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("review queue degraded-state helper distinguishes no-data/backend-unreachable/partial-failure", () => {
  const pagePath = path.join(__dirname, "..", "src", "renderer", "features", "review", "review-queue-page.js");
  delete require.cache[pagePath];
  require(pagePath);

  const helpers = global.reviewQueuePage.__test;

  const backendDown = helpers.resolveQueueState({ hasItems: false, backendUnreachable: true });
  const partial = helpers.resolveQueueState({ hasItems: true, backendUnreachable: true });
  const generic = helpers.resolveQueueState({ hasItems: false, backendUnreachable: false });

  assert.equal(helpers.isBackendUnreachable({ reason: "OPERATIONS_BACKEND_UNREACHABLE:fetch" }), true);
  assert.equal(backendDown.tone, "error");
  assert.match(backendDown.feedback, /backend is unreachable/i);
  assert.equal(partial.tone, "warning");
  assert.match(partial.feedback, /showing last loaded review queue/i);
  assert.equal(generic.tone, "error");
  assert.match(generic.feedback, /failed to load review queue/i);
});
