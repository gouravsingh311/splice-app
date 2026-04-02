const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("review queue triage helpers apply deterministic sort and age/risk filters", () => {
  const queuePath = path.join(__dirname, "..", "src", "renderer", "features", "review", "review-queue-page.js");
  delete require.cache[queuePath];
  require(queuePath);

  const helpers = global.reviewQueuePage.__test;
  assert.ok(helpers);

  const items = [
    {
      submissionId: "sub-a",
      submittedAt: "2026-03-01T10:00:00.000Z",
      ageDays: 8,
      state: "under_review",
      flags: [{ severity: "low" }],
    },
    {
      submissionId: "sub-b",
      submittedAt: "2026-03-05T10:00:00.000Z",
      ageDays: 4,
      state: "under_review",
      flags: [{ severity: "high" }],
    },
    {
      submissionId: "sub-c",
      submittedAt: "2026-03-02T10:00:00.000Z",
      ageDays: 7,
      state: "under_review",
      flags: [{ severity: "medium" }],
    },
    {
      submissionId: "sub-d",
      submittedAt: "2026-03-04T10:00:00.000Z",
      ageDays: 1,
      state: "approved",
      flags: [],
    },
  ];

  const sorted = helpers.sortForTriage(items);
  assert.deepEqual(
    sorted.map((item) => item.submissionId),
    ["sub-b", "sub-c", "sub-a", "sub-d"],
  );

  const filtered = helpers.applyClientFilters(items, {
    state: "under_review",
    ageBucket: "3-7",
    riskLevel: "medium",
  });
  assert.deepEqual(filtered.map((item) => item.submissionId), ["sub-c"]);

  assert.equal(helpers.getRiskLabel({ flags: [] }), "None");
  assert.equal(helpers.getRiskLabel({ flags: [{ severity: "critical" }] }), "High");
});
