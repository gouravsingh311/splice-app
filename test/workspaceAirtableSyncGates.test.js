/**
 * APUI-T06: Submit readiness consistency with Airtable link state.
 *
 * Verifies that buildCanonicalReadiness aligns readiness summary + blockers
 * with the canonical workflow gate (Airtable-linked check included), so the
 * "All checks passed" copy and Submit button enabled state are never contradictory.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const workspacePage = require("../src/renderer/workspace/workspace-page.js");
const helpers = workspacePage.__test;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FULL_DRAFT = {
  submissionId: "sub-t06",
  packName: "Resonance Pack",
  labelName: "Splice",
  releaseMonth: "2026-09",
  notes: "test",
  tags: ["electronic"],
};

const FULL_FOLDER = {
  path: "/tmp/pack",
  fileCount: 10,
  files: [{ relativePath: "Audio/Label - Pack.zip", sizeBytes: 1000 }],
};

// A workflow context where all gates pass INCLUDING Airtable.
function makePastAllWorkflowContext(overrides) {
  return Object.assign(
    {
      blockers: [],
      canSubmit: true,
      activeStep: "review",
      airtableFormCompleted: true,
      airtablePayloadChecksum: "chk-abc",
      airtableLinkedKnown: true,
      airtableLinked: true,
    },
    overrides || {}
  );
}

// A workflow context where Airtable is not linked.
function makeAirtableUnlinkedWorkflowContext() {
  return {
    blockers: [
      "Airtable details still need attention before submitting. Next step: sync Airtable details again.",
    ],
    canSubmit: false,
    activeStep: "airtable",
    airtableFormCompleted: true,
    airtablePayloadChecksum: "chk-abc",
    airtableLinkedKnown: true,
    airtableLinked: false,
  };
}

// ---------------------------------------------------------------------------
// Test: local gates all pass, workflow context all pass → canSubmit true
// ---------------------------------------------------------------------------

test("buildCanonicalReadiness: all gates pass → canSubmit true, no blockers", () => {
  const readiness = helpers.buildCanonicalReadiness({
    draft: FULL_DRAFT,
    selectedFolder: FULL_FOLDER,
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
    workflowContext: makePastAllWorkflowContext(),
  });

  assert.equal(readiness.canSubmit, true);
  assert.deepEqual(readiness.blockers, []);
});

// ---------------------------------------------------------------------------
// Test: all local gates pass, but Airtable not linked → canSubmit false
// ---------------------------------------------------------------------------

test("buildCanonicalReadiness: local gates pass, Airtable not linked → canSubmit false with Airtable blocker", () => {
  const readiness = helpers.buildCanonicalReadiness({
    draft: FULL_DRAFT,
    selectedFolder: FULL_FOLDER,
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
    workflowContext: makeAirtableUnlinkedWorkflowContext(),
  });

  assert.equal(readiness.canSubmit, false, "canSubmit must be false when Airtable not linked");
  assert.ok(readiness.blockers.length > 0, "Must have at least one blocker when Airtable not linked");
  const codes = readiness.blockers.map((b) => b.code);
  assert.ok(
    codes.includes("airtable_not_linked") || codes.includes("airtable_link_unverified") || codes.includes("airtable_incomplete"),
    `Expected an Airtable blocker code, got: ${codes.join(", ")}`
  );
});

// ---------------------------------------------------------------------------
// Test: readiness summary text is consistent with canSubmit===false
// ---------------------------------------------------------------------------

test("buildReadinessSummaryText: never says 'All checks passed' when canSubmit false", () => {
  const readiness = helpers.buildCanonicalReadiness({
    draft: FULL_DRAFT,
    selectedFolder: FULL_FOLDER,
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
    workflowContext: makeAirtableUnlinkedWorkflowContext(),
  });

  assert.equal(readiness.canSubmit, false);
  const summaryText = helpers.buildReadinessSummaryText(readiness);
  assert.ok(
    !/All checks passed/i.test(summaryText),
    `Summary must not say "All checks passed" when canSubmit is false. Got: "${summaryText}"`
  );
  assert.match(summaryText, /blocked/i, `Summary should mention blocked state. Got: "${summaryText}"`);
});

// ---------------------------------------------------------------------------
// Test: readiness summary says "All checks passed" ONLY when genuinely ready
// ---------------------------------------------------------------------------

test("buildReadinessSummaryText: says 'All checks passed' only when canSubmit true", () => {
  const readiness = helpers.buildCanonicalReadiness({
    draft: FULL_DRAFT,
    selectedFolder: FULL_FOLDER,
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
    workflowContext: makePastAllWorkflowContext(),
  });

  assert.equal(readiness.canSubmit, true);
  const summaryText = helpers.buildReadinessSummaryText(readiness);
  assert.match(summaryText, /All checks passed/i);
});

// ---------------------------------------------------------------------------
// Test: Airtable incomplete → local gates pass → Airtable blocker surfaces first
// ---------------------------------------------------------------------------

test("buildCanonicalReadiness: Airtable incomplete blocker surfaces even when local gates pass", () => {
  const workflowContext = {
    blockers: ["Complete Airtable Submission Details before submitting."],
    canSubmit: false,
    activeStep: "airtable",
    airtableFormCompleted: false,
    airtablePayloadChecksum: "",
    airtableLinkedKnown: false,
    airtableLinked: false,
  };

  const readiness = helpers.buildCanonicalReadiness({
    draft: FULL_DRAFT,
    selectedFolder: FULL_FOLDER,
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
    workflowContext: workflowContext,
  });

  assert.equal(readiness.canSubmit, false);
  const codes = readiness.blockers.map((b) => b.code);
  assert.ok(
    codes.some((c) => c.startsWith("airtable")),
    `Expected an airtable_* blocker in first position, got: ${codes.join(", ")}`
  );
});

// ---------------------------------------------------------------------------
// Test: mapWorkflowBlockersToReadiness produces actionable blocker for airtable_not_linked
// ---------------------------------------------------------------------------

test("mapWorkflowBlockersToReadiness: airtableLinked=false produces airtable_not_linked blocker", () => {
  const workflowContext = {
    // blockers must be non-empty for the function to proceed past the early-return guard.
    blockers: ["Airtable details still need attention before submitting."],
    airtableFormCompleted: true,
    airtablePayloadChecksum: "chk-abc",
    airtableLinkedKnown: true,
    airtableLinked: false,
  };

  const blockers = helpers.mapWorkflowBlockersToReadiness(workflowContext);
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, "airtable_not_linked");
  assert.ok(blockers[0].nextAction, "Blocker must have a nextAction CTA");
});

// ---------------------------------------------------------------------------
// Test: mapWorkflowBlockersToReadiness returns empty when Airtable is linked
// ---------------------------------------------------------------------------

test("mapWorkflowBlockersToReadiness: Airtable fully linked → no blockers", () => {
  const workflowContext = {
    blockers: [],
    airtableFormCompleted: true,
    airtablePayloadChecksum: "chk-abc",
    airtableLinkedKnown: true,
    airtableLinked: true,
  };

  const blockers = helpers.mapWorkflowBlockersToReadiness(workflowContext);
  assert.deepEqual(blockers, []);
});

// ---------------------------------------------------------------------------
// Test: buildCanonicalReadiness falls back gracefully without workflowContext
// ---------------------------------------------------------------------------

test("buildCanonicalReadiness: no workflowContext falls back to local evaluateSubmitReadiness", () => {
  const readiness = helpers.buildCanonicalReadiness({
    draft: FULL_DRAFT,
    selectedFolder: FULL_FOLDER,
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
    workflowContext: null,
  });

  // Without workflowContext, pure local gate: should pass since all local gates pass.
  assert.equal(readiness.canSubmit, true);
  assert.deepEqual(readiness.blockers, []);
});

// ---------------------------------------------------------------------------
// Test: resolveDraftFocusTargetForReadiness maps Airtable blocker codes to correct target
// ---------------------------------------------------------------------------

test("resolveDraftFocusTargetForReadiness: airtable_not_linked maps to workspace-airtable-complete", () => {
  const focus = helpers.resolveDraftFocusTargetForReadiness({
    blockers: [{ code: "airtable_not_linked" }],
  });
  assert.equal(focus, "workspace-airtable-complete");
});

test("resolveDraftFocusTargetForReadiness: airtable_incomplete maps to workspace-airtable-complete", () => {
  const focus = helpers.resolveDraftFocusTargetForReadiness({
    blockers: [{ code: "airtable_incomplete" }],
  });
  assert.equal(focus, "workspace-airtable-complete");
});
