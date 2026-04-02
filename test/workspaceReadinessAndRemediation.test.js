const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const workspacePage = require("../src/renderer/workspace/workspace-page.js");
const qcGuidanceCatalog = require("../src/renderer/features/qc/guidance-catalog.js");

const helpers = workspacePage.__test;

test("evaluateSubmitReadiness returns deterministic blocker order", () => {
  const readiness = helpers.evaluateSubmitReadiness({
    draft: {
      packName: "",
      labelName: "",
      releaseMonth: "",
    },
    selectedFolder: null,
    missingTopLevelFolders: [],
    qcPassed: false,
    isSubmitting: false,
  });

  assert.equal(readiness.canSubmit, false);
  assert.deepEqual(
    readiness.blockers.map((blocker) => blocker.code),
    ["metadata_incomplete", "pack_folder_missing", "qc_not_passed"],
  );
});

test("evaluateSubmitReadiness reports invalid release month format deterministically", () => {
  const readiness = helpers.evaluateSubmitReadiness({
    draft: {
      packName: "Pack",
      labelName: "Label",
      releaseMonth: "2026/03",
    },
    selectedFolder: {
      path: "/tmp/pack",
      fileCount: 10,
      files: [{ relativePath: "Audio/Label - Pack.zip", sizeBytes: 1000 }],
    },
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
  });

  assert.equal(readiness.canSubmit, false);
  assert.deepEqual(
    readiness.blockers.map((blocker) => blocker.code),
    ["release_month_format_invalid"],
  );
});

test("evaluateSubmitReadiness allows submit only when all checks pass", () => {
  const readiness = helpers.evaluateSubmitReadiness({
    draft: {
      packName: "Pack",
      labelName: "Label",
      releaseMonth: "2026-03",
    },
    selectedFolder: {
      path: "/tmp/pack",
      fileCount: 10,
      files: [{ relativePath: "Audio/Label - Pack.zip", sizeBytes: 1000 }],
    },
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
  });

  assert.equal(readiness.canSubmit, true);
  assert.deepEqual(readiness.blockers, []);
});

test("evaluateSubmitReadiness blocks submit when restored folder has empty file inventory", () => {
  const readiness = helpers.evaluateSubmitReadiness({
    draft: {
      packName: "Pack",
      labelName: "Label",
      releaseMonth: "2026-03",
    },
    selectedFolder: {
      path: "/tmp/pack",
      fileCount: 330,
      files: [],
    },
    missingTopLevelFolders: [],
    qcPassed: true,
    isSubmitting: false,
  });

  assert.equal(readiness.canSubmit, false);
  assert.deepEqual(
    readiness.blockers.map((blocker) => blocker.code),
    ["pack_folder_empty"],
  );
});

test("buildSubmitBlockedFeedbackMessage provides deterministic next-action guidance for multiple blockers", () => {
  const message = helpers.buildSubmitBlockedFeedbackMessage({
    canSubmit: false,
    blockers: [
      { title: "Metadata Required", message: "metadata", nextAction: "complete metadata" },
      { title: "Pack Folder Required", message: "folder", nextAction: "pick folder" },
      { title: "QC Must Pass", message: "qc", nextAction: "run qc" },
    ],
  });

  assert.equal(
    message,
    "Submit is blocked: Metadata Required | Pack Folder Required | QC Must Pass. Next step: complete the blocker list below, then submit again.",
  );
});

test("resolveDraftFocusTargetForReadiness maps first blocker to the deterministic next control", () => {
  const metadataFocus = helpers.resolveDraftFocusTargetForReadiness({
    blockers: [{ code: "metadata_incomplete" }],
  });
  const folderFocus = helpers.resolveDraftFocusTargetForReadiness({
    blockers: [{ code: "pack_folder_missing" }],
  });
  const qcFocus = helpers.resolveDraftFocusTargetForReadiness({
    blockers: [{ code: "qc_not_passed" }],
  });

  assert.equal(metadataFocus, "workspace-pack-name");
  assert.equal(folderFocus, "workspace-select-pack-folder");
  assert.equal(qcFocus, "workspace-run-qc");
});

test("buildCreatorRemediationItems maps findings to creator-readable remediation and next actions", () => {
  globalThis.qcGuidanceCatalog = qcGuidanceCatalog;
  const items = helpers.buildCreatorRemediationItems([
    {
      ruleId: "SAMPLE_NORMALIZATION_OUT_OF_RANGE",
      severity: "warning",
      context: { file_ref: "Audio/Loops/kick.wav" },
    },
    {
      ruleId: "AUDIO_ZIP_NAMING",
      severity: "blocking",
      context: { file_ref: "Audio/Bad Name.zip" },
    },
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0].ruleId, "AUDIO_ZIP_NAMING");
  assert.equal(items[0].severity, "blocking");
  assert.match(items[0].remediation, /Rename/i);
  assert.equal(items[0].nextAction, "Fix this issue, then run QC again.");
  assert.equal(items[1].severity, "warning");
  assert.equal(items[1].nextAction, "Recommended: fix this warning before submitting.");
  delete globalThis.qcGuidanceCatalog;
});

test("buildRemediationMarkup renders full findings list in a scrollable keyboard-accessible container", () => {
  globalThis.qcGuidanceCatalog = qcGuidanceCatalog;
  const findings = Array.from({ length: 12 }, (_, index) => ({
    ruleId: "SAMPLE_FORMAT_INVALID",
    severity: index === 0 ? "blocking" : "warning",
    context: { file_ref: `Audio/Loops/file-${index}.wav` },
  }));

  const markup = helpers.buildRemediationMarkup({ findings });
  assert.match(markup, /id="workspace-remediation-items"/);
  assert.match(markup, /max-h-96 overflow-y-auto/);
  assert.match(markup, /tabindex="0"/);
  assert.equal((markup.match(/<li class=/g) || []).length, 12);

  delete globalThis.qcGuidanceCatalog;
});

test("buildQcRunStatusMarkup shows spinner while running and plain completion copy after run", () => {
  const runningMarkup = helpers.buildQcRunStatusMarkup({
    tone: "running",
    message: "QC running... Please wait.",
  });
  const completeMarkup = helpers.buildQcRunStatusMarkup({
    tone: "success",
    message: "QC finished: passed with no blocking findings.",
  });

  assert.match(runningMarkup, /workspace-qc-run-status/);
  assert.match(runningMarkup, /animate-spin/);
  assert.match(runningMarkup, /QC running/);
  assert.match(completeMarkup, /QC finished: passed/);
  assert.equal(/animate-spin/.test(completeMarkup), false);
});

test("buildManifestFilesFromSelection hashes manifest entries and checksum deterministically", async () => {
  const selectedFolder = {
    path: "/tmp/pack",
    files: [
      {
        relativePath: "Audio/Label - Pack.zip",
        sizeBytes: 1024,
        mimeType: "application/zip",
      },
      {
        relativePath: "Artwork/Cover Art/cover.png",
        sizeBytes: 2048,
        mimeType: "image/png",
      },
    ],
  };

  const files = await helpers.buildManifestFilesFromSelection(selectedFolder);
  const checksum = await helpers.buildManifestChecksum(files);

  assert.equal(files.length, 2);
  assert.match(files[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(files[1].sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(files[0].sha256, "0".repeat(64));
  assert.notEqual(files[1].sha256, "0".repeat(64));

  const canonicalPayload = files
    .slice()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((entry) =>
      [
        entry.relativePath.trim().replace(/\\/g, "/"),
        String(Math.max(1, Number(entry.sizeBytes || 1))),
        entry.sha256.trim().toLowerCase(),
        entry.mimeType.trim().toLowerCase(),
        entry.category.trim().toLowerCase(),
        entry.requiredAsset ? "1" : "0",
      ].join("\u001f"),
    )
    .join("\u001e");
  const expectedChecksum = crypto
    .createHash("sha256")
    .update(canonicalPayload, "utf8")
    .digest("hex");

  assert.equal(checksum, expectedChecksum);
});

test("logWorkspaceOptionalDependencyFailure emits a deterministic console prefix", () => {
  const calls = [];
  const originalError = console.error;
  console.error = (...args) => {
    calls.push(args);
  };

  try {
    helpers.logWorkspaceOptionalDependencyFailure("workspaceReadiness", new Error("boom"));
  } finally {
    console.error = originalError;
  }

  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /\[workspace-page\]/);
  assert.match(String(calls[0][0]), /workspaceReadiness/);
});

test("mergeDraftState preserves user-entered releaseMonth and metadata across rerender-triggering actions", () => {
  const persisted = helpers.mergeDraftState(
    {
      submissionId: "sub-1",
      packName: "Original Pack",
      labelName: "Original Label",
      releaseMonth: "2026-03",
      notes: "original notes",
      tags: ["original"],
    },
    {
      submissionId: "sub-1",
      packName: "Updated Pack",
      labelName: "Updated Label",
      releaseMonth: "2026-12",
      notes: "updated notes",
      tags: ["updated", "tag"],
    },
  );

  assert.deepEqual(persisted, {
    submissionId: "sub-1",
    packName: "Updated Pack",
    labelName: "Updated Label",
    releaseMonth: "2026-12",
    notes: "updated notes",
    tags: ["updated", "tag"],
  });
});

test("buildReleaseMonthOptions keeps selected releaseMonth even when outside rolling 18-month window", () => {
  const options = helpers.buildReleaseMonthOptions("2024-01");
  assert.match(options, /<option value="2024-01">2024-01<\/option>/);
});

test("toCreatorSafeSurfaceMessage redacts policy diagnostics from creator flow", () => {
  const qcMessage = helpers.toCreatorSafeSurfaceMessage(
    "qc",
    "QC_POLICY_VERSION_CONFLICT: expected_policy_version mismatch",
  );
  const submitMessage = helpers.toCreatorSafeSurfaceMessage(
    "submit",
    "version conflict from splice.admin.qc-policy.update.v1",
  );

  assert.equal(
    qcMessage,
    "QC could not finish. Next step: try Run QC again in a moment.",
  );
  assert.equal(
    submitMessage,
    "Your submission did not go through. Next step: wait a moment, then click Submit for Review again.",
  );
});

test("toCreatorSafeSurfaceMessage redacts network-level diagnostics from creator flow", () => {
  const metadataMessage = helpers.toCreatorSafeSurfaceMessage(
    "metadata",
    "ECONNREFUSED while invoking ipc channel",
  );
  assert.equal(metadataMessage, "Metadata sync is unavailable because backend is unreachable. Retry after API recovery.");
});

test("toCreatorSafeSurfaceMessage classifies backend-unreachable errors with deterministic recovery guidance", () => {
  const qcMessage = helpers.toCreatorSafeSurfaceMessage(
    "qc",
    "QC backend is unavailable: failed to fetch",
  );
  const metadataMessage = helpers.toCreatorSafeSurfaceMessage(
    "metadata",
    "Operations backend is unavailable",
  );

  assert.equal(
    qcMessage,
    "QC backend is unreachable. Start the API service, then rerun QC.",
  );
  assert.equal(
    metadataMessage,
    "Metadata sync is unavailable because backend is unreachable. Retry after API recovery.",
  );
});
