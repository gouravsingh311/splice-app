const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

test("review queue/detail templates expose required PRD-08 contract IDs and reason options", () => {
  const queuePath = path.join(__dirname, "..", "src", "renderer", "features", "review", "review-queue-page.js");
  const queueRenderPath = path.join(__dirname, "..", "src", "renderer", "features", "review", "review-queue-render.js");
  const detailPath = path.join(__dirname, "..", "src", "renderer", "features", "review", "review-detail-page.js");

  delete require.cache[queuePath];
  delete require.cache[queueRenderPath];
  delete require.cache[detailPath];
  require(queuePath);
  require(queueRenderPath);
  require(detailPath);

  const queueTemplate = global.reviewQueuePage.getTemplate();
  const queueRenderSource = fs.readFileSync(queueRenderPath, "utf8");
  assert.equal(queueTemplate.includes('id="review-queue-tbody"'), true);
  assert.equal(queueTemplate.includes("Age (days)"), true);
  assert.equal(queueTemplate.includes("<th class=\"fe-th text-right\">Triage</th>"), true);
  assert.equal(queueRenderSource.includes("data-open-review-detail"), true);
  assert.equal(queueRenderSource.includes("data-quick-approve"), true);
  assert.equal(queueRenderSource.includes("data-quick-reject"), true);

  const detailTemplate = global.reviewDetailPage.getTemplate();
  assert.equal(detailTemplate.includes('id="review-reject-reason"'), true);
  assert.equal(detailTemplate.includes("QUALITY_ISSUES"), true);
  assert.equal(detailTemplate.includes("METADATA_MISSING"), true);
  assert.equal(detailTemplate.includes("POLICY_VIOLATION"), true);
  assert.equal(detailTemplate.includes("OTHER"), true);
  assert.equal(detailTemplate.includes('id="review-reject-validation"'), true);
  assert.equal(detailTemplate.includes('role="dialog"'), true);
  assert.equal(detailTemplate.includes("aria-modal=\"true\""), true);
  assert.equal(detailTemplate.includes("aria-label=\"Reject submission\""), true);
  assert.equal(detailTemplate.includes("aria-label=\"Re-open submission for amendment\""), true);
  assert.equal(detailTemplate.includes('id="review-action-guidance"'), true);
  assert.equal(detailTemplate.includes("Include clear amendment guidance for the creator."), true);
  assert.equal(detailTemplate.includes('id="review-confirm-guidance"'), true);
  assert.equal(detailTemplate.includes('for="review-add-flag-type"'), true);
  assert.equal(detailTemplate.includes("aria-label=\"Flag severity\""), true);
  assert.equal(detailTemplate.includes("required"), true);
});
