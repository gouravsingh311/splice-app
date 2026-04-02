const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

test("submission detail shows rejection reason/notes and explicit restart guidance", () => {
  const componentPath = path.join(
    __dirname,
    "..",
    "src",
    "renderer",
    "features",
    "workspace",
    "components",
    "submission-detail.js",
  );
  delete require.cache[componentPath];
  const component = require(componentPath);

  const html = component.renderSubmissionDetail({
    submission: {
      submissionId: "sub-1",
      currentState: "rejected",
      packName: "Test Pack",
      releaseMonth: "2026-04",
      notes: "n/a",
      updatedAt: "2026-03-30T16:20:00Z",
    },
    selectedTimeline: [
      {
        toState: "rejected",
        reason: "QUALITY_ISSUES",
        reviewReasonCode: "QUALITY_ISSUES",
        reviewNotes: "Missing artwork and invalid metadata.",
        createdAt: "2026-03-30T16:19:00Z",
      },
    ],
    escapeHtml,
  });

  assert.match(html, /Latest Rejection Detail/i);
  assert.match(html, /Quality Issues/i);
  assert.match(html, /Missing artwork and invalid metadata\./i);
  assert.match(html, /Reviewer\/Admin must click Re-open first/i);
});
