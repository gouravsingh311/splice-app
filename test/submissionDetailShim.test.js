const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("submission detail view is rendered as fallback shim to submissions workflow", () => {
  const detailViewPath = path.join(__dirname, "..", "src", "renderer", "features", "workspace", "views", "submission-detail-view.js");
  delete require.cache[detailViewPath];
  require(detailViewPath);

  const template = global.viewSubmissionDetail.getTemplate();
  assert.equal(template.includes('id="submission-detail-shim-card"'), true);
  assert.equal(template.includes('data-nav="submissions"'), true);
  assert.match(template, /fallback shim only/i);
  assert.match(template, /submission lifecycle detail and reopen actions now live in/i);

  assert.doesNotThrow(() => {
    global.viewSubmissionDetail.load({
      id: "sub-1",
      status: "rejected",
    });
  });
});
