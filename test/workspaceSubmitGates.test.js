const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const packStructurePath = path.join(__dirname, "..", "src", "renderer", "workspace", "pack-structure.js");
const workspacePagePath = path.join(__dirname, "..", "src", "renderer", "workspace", "workspace-page.js");

const packStructure = require(packStructurePath);
global.workspacePackStructure = packStructure;
delete require.cache[workspacePagePath];
const workspacePage = require(workspacePagePath);
delete global.workspacePackStructure;

const testApi = workspacePage.__test || {};

test("hasValidReleaseMonth accepts and rejects expected values", () => {
  assert.equal(typeof testApi.hasValidReleaseMonth, "function");
  assert.equal(testApi.hasValidReleaseMonth("2026-03"), true);
  assert.equal(testApi.hasValidReleaseMonth("2026-13"), false);
  assert.equal(testApi.hasValidReleaseMonth(""), false);
});

test("resolveSubmitGateStatus blocks submit when structure gate fails", () => {
  const result = testApi.resolveSubmitGateStatus({
    draft: {
      submissionId: "sub-1",
      packName: "Pack",
      labelName: "Label",
      releaseMonth: "2026-04",
    },
    submissionId: "sub-1",
    selectedFolder: { path: "/tmp/pack" },
    missingFolders: ["Demo/Demos"],
    qcPassedBySubmissionId: { "sub-1": true },
    isSubmitting: false,
  });

  assert.equal(result.canSubmit, false);
  assert.equal(result.blockedGateId, "required-folders");
  assert.match(result.blockingMessage, /Phase 1 submission is blocked/i);
  assert.match(result.blockingMessage, /Add these folders at the top level/i);
});

test("resolveSubmitGateStatus blocks submit on first failing gate deterministically", () => {
  const result = testApi.resolveSubmitGateStatus({
    draft: {
      submissionId: "",
      packName: "",
      labelName: "",
      releaseMonth: "",
    },
    submissionId: "",
    selectedFolder: null,
    missingFolders: [],
    qcPassedBySubmissionId: {},
    isSubmitting: false,
  });

  assert.equal(result.canSubmit, false);
  assert.equal(result.blockedGateId, "metadata");
  assert.match(result.blockingMessage, /Complete Pack Name, Label Name, and Release Month/i);
});

test("resolveSubmitGateStatus allows submit only when all gates pass", () => {
  const result = testApi.resolveSubmitGateStatus({
    draft: {
      submissionId: "sub-2",
      packName: "Pack",
      labelName: "Label",
      releaseMonth: "2026-05",
    },
    submissionId: "sub-2",
    selectedFolder: { path: "/tmp/pack" },
    missingFolders: [],
    qcPassedBySubmissionId: { "sub-2": true },
    isSubmitting: false,
  });

  assert.equal(result.canSubmit, true);
  assert.equal(result.blockedGateId, "");
  assert.equal(result.gates.every((gate) => gate.passed), true);
});
