const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("workspace lifecycle visibility keeps rejected reopen gated and reopened draft editable", () => {
  const workspacePath = path.join(
    __dirname,
    "..",
    "src",
    "renderer",
    "workspace",
    "workspace-page.js",
  );

  delete require.cache[workspacePath];
  require(workspacePath);

  const workspaceApi = global.creatorWorkspacePage;
  assert.ok(workspaceApi);
  assert.ok(workspaceApi.__test);

  const helpers = workspaceApi.__test;

  const rejectedVisibility = helpers.resolveLifecycleVisibility(
    { currentState: "rejected" },
    [{ toState: "under_review" }],
  );
  assert.equal(rejectedVisibility.showEditAction, false);
  assert.match(rejectedVisibility.heading, /awaiting reviewer\/admin reopen/i);

  const reopenedDraftVisibility = helpers.resolveLifecycleVisibility(
    { currentState: "draft" },
    [{ toState: "rejected" }, { toState: "draft" }],
  );
  assert.equal(reopenedDraftVisibility.showEditAction, true);
  assert.equal(reopenedDraftVisibility.actionLabel, "Continue Reopened Draft");
  assert.match(reopenedDraftVisibility.heading, /reopened for amendment/i);

  const plainDraftVisibility = helpers.resolveLifecycleVisibility(
    { currentState: "draft" },
    [{ toState: "under_review" }],
  );
  assert.equal(plainDraftVisibility.showEditAction, true);
  assert.equal(plainDraftVisibility.actionLabel, "Continue Draft");
  assert.match(plainDraftVisibility.heading, /draft in progress/i);
});

test("workspace lifecycle helper detects rejected transition history", () => {
  const workspacePath = path.join(
    __dirname,
    "..",
    "src",
    "renderer",
    "workspace",
    "workspace-page.js",
  );

  delete require.cache[workspacePath];
  require(workspacePath);

  const helpers = global.creatorWorkspacePage.__test;
  assert.equal(helpers.hasRejectedLifecycleEvent([]), false);
  assert.equal(helpers.hasRejectedLifecycleEvent([{ toState: "under_review" }]), false);
  assert.equal(helpers.hasRejectedLifecycleEvent([{ toState: "rejected" }]), true);
});

test("workspace needs-action resolver prioritizes reopened draft over rejected", () => {
  const workspacePath = path.join(
    __dirname,
    "..",
    "src",
    "renderer",
    "workspace",
    "workspace-page.js",
  );

  delete require.cache[workspacePath];
  require(workspacePath);

  const helpers = global.creatorWorkspacePage.__test;
  const submissions = [
    {
      submissionId: "sub-rejected",
      currentState: "rejected",
      updatedAt: "2026-03-09T10:01:00Z",
    },
    {
      submissionId: "sub-reopened",
      currentState: "draft",
      updatedAt: "2026-03-09T10:00:00Z",
    },
  ];
  const timelines = {
    "sub-rejected": [{ toState: "rejected" }],
    "sub-reopened": [{ toState: "rejected" }, { toState: "draft" }],
  };

  const rejectedDescriptor = helpers.resolveNeedsActionDescriptor(
    submissions[0],
    timelines["sub-rejected"],
  );
  assert.equal(rejectedDescriptor.needsAction, true);
  assert.equal(rejectedDescriptor.kind, "rejected");

  const reopenedDescriptor = helpers.resolveNeedsActionDescriptor(
    submissions[1],
    timelines["sub-reopened"],
  );
  assert.equal(reopenedDescriptor.needsAction, true);
  assert.equal(reopenedDescriptor.kind, "reopened");

  const target = helpers.resolveNeedsActionTargetSubmissionId(submissions, timelines);
  assert.equal(target, "sub-reopened");
});
