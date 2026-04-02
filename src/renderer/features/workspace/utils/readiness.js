(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceReadiness = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  var packStructure = (
    typeof globalThis !== 'undefined' &&
    globalThis.workspacePackStructure &&
    typeof globalThis.workspacePackStructure === 'object'
  ) ? globalThis.workspacePackStructure : null;

  function resolveMissingRequiredFolders(topLevelFolders) {
    if (packStructure && typeof packStructure.resolveMissingRequiredTopLevelFolders === 'function') {
      return packStructure.resolveMissingRequiredTopLevelFolders(topLevelFolders);
    }
    return [];
  }

  function buildStructureGateMessage(missingFolders) {
    if (packStructure && typeof packStructure.buildStructureGateMessage === 'function') {
      return packStructure.buildStructureGateMessage(missingFolders);
    }
    if (!Array.isArray(missingFolders) || missingFolders.length === 0) {
      return 'Phase 1 required top-level folders detected.';
    }
    return (
      'Phase 1 submission is blocked until required top-level folders are present: ' +
      missingFolders.join(', ') +
      '.'
    );
  }

  function buildMissingRequiredFolderGuidance(missingFolders) {
    if (packStructure && typeof packStructure.buildMissingRequiredFolderGuidance === 'function') {
      return packStructure.buildMissingRequiredFolderGuidance(missingFolders);
    }
    if (!Array.isArray(missingFolders) || missingFolders.length === 0) {
      return 'Required top-level folder structure is complete.';
    }
    return 'Add these folders at the top level before continuing: ' + missingFolders.join(', ') + '.';
  }

  function resolveTopLevelFolderChecklist(topLevelFolders) {
    if (packStructure && typeof packStructure.resolveTopLevelFolderChecklist === 'function') {
      return packStructure.resolveTopLevelFolderChecklist(topLevelFolders);
    }
    return [];
  }


  function getMissingMetadataFields(draft) {
    var missing = [];
    if (!draft || !String(draft.packName || '').trim()) {
      missing.push('Pack Name');
    }
    if (!draft || !String(draft.labelName || '').trim()) {
      missing.push('Label Name');
    }
    if (!draft || !String(draft.releaseMonth || '').trim()) {
      missing.push('Release Month');
    }
    return missing;
  }

  function hasValidReleaseMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '').trim());
  }

  function evaluateSubmitReadiness(input) {
    var blockers = [];
    var draft = input && input.draft ? input.draft : {};
    var selectedFolder = input && input.selectedFolder ? input.selectedFolder : null;
    var missingTopLevelFolders = Array.isArray(input && input.missingTopLevelFolders)
      ? input.missingTopLevelFolders
      : [];
    var hasFileInventory = Boolean(selectedFolder && Array.isArray(selectedFolder.files));
    var fileCount = selectedFolder
      ? Number(selectedFolder.fileCount || (Array.isArray(selectedFolder.files) ? selectedFolder.files.length : 0))
      : 0;
    var missingMetadata = getMissingMetadataFields(draft);

    if (input && input.isSubmitting) {
      blockers.push({
        code: 'submit_in_progress',
        title: 'Submit In Progress',
        message: 'Submission is already in progress. Wait for the current upload to finish.',
        nextAction: 'Wait until progress reaches 100% before retrying.',
      });
    }

    if (missingMetadata.length > 0) {
      blockers.push({
        code: 'metadata_incomplete',
        title: 'Metadata Required',
        message: 'Complete required metadata: ' + missingMetadata.join(', ') + '.',
        nextAction: 'Fill in the missing fields and save metadata.',
      });
    } else if (!hasValidReleaseMonth(draft.releaseMonth)) {
      blockers.push({
        code: 'release_month_format_invalid',
        title: 'Release Month Format',
        message: 'Release Month must use YYYY-MM format.',
        nextAction: 'Use a value like 2026-03.',
      });
    }

    if (!selectedFolder || !selectedFolder.path) {
      blockers.push({
        code: 'pack_folder_missing',
        title: 'Pack Folder Required',
        message: 'Select your pack folder before submitting.',
        nextAction: 'Click Select Pack Folder and choose the submission folder.',
      });
    } else if ((hasFileInventory && selectedFolder.files.length <= 0) || fileCount <= 0) {
      blockers.push({
        code: 'pack_folder_empty',
        title: 'Pack Folder Empty',
        message: 'Selected pack folder does not contain files.',
        nextAction: 'Choose a folder with pack assets and try again.',
      });
    }

    if (missingTopLevelFolders.length > 0) {
      blockers.push({
        code: 'required_folders_missing',
        title: 'Required Folders Missing',
        message: buildStructureGateMessage(missingTopLevelFolders),
        nextAction: 'Add missing top-level folders, then run QC again.',
      });
    }

    if (!input || input.qcPassed !== true) {
      blockers.push({
        code: 'qc_not_passed',
        title: 'QC Must Pass',
        message: 'Run QC and resolve blocking findings before submitting for review.',
        nextAction: 'Run QC, fix blockers, then rerun until status is passed.',
      });
    }

    return {
      canSubmit: blockers.length === 0,
      blockers: blockers,
    };
  }

  function mapWorkflowBlockersToReadiness(workflowContext) {
    var blockers = [];
    if (!workflowContext || !Array.isArray(workflowContext.blockers) || workflowContext.blockers.length === 0) {
      return blockers;
    }
    if (!workflowContext.airtableFormCompleted) {
      blockers.push({
        code: 'airtable_incomplete',
        title: 'Airtable Step Required',
        message: 'Airtable submission details are not complete yet.',
        nextAction: 'Click Sync Airtable Details, then confirm it is linked.',
      });
      return blockers;
    }
    if (!workflowContext.airtablePayloadChecksum) {
      blockers.push({
        code: 'airtable_checksum_missing',
        title: 'Airtable Mapping Required',
        message: 'Airtable details are missing required mapped values.',
        nextAction: 'Resync Airtable details, then verify this step is complete.',
      });
      return blockers;
    }
    if (!workflowContext.airtableLinkedKnown) {
      blockers.push({
        code: 'airtable_link_unverified',
        title: 'Airtable Link Not Confirmed',
        message: 'Airtable link status is still being verified.',
        nextAction: 'Click Sync Airtable Details again until link status is confirmed.',
      });
      return blockers;
    }
    if (!workflowContext.airtableLinked) {
      blockers.push({
        code: 'airtable_not_linked',
        title: 'Airtable Link Required',
        message: 'Airtable details are not linked to a matching submission record yet.',
        nextAction: 'Fix the linked Airtable record, then sync again.',
      });
      return blockers;
    }
    return blockers;
  }

  function buildCanonicalReadiness(options) {
    var draft = options && options.draft ? options.draft : {};
    var selectedFolder = options && options.selectedFolder ? options.selectedFolder : null;
    var missingTopLevelFolders = Array.isArray(options && options.missingTopLevelFolders)
      ? options.missingTopLevelFolders : [];
    var qcPassed = Boolean(options && options.qcPassed);
    var isSubmitting = Boolean(options && options.isSubmitting);
    var workflowContext = options && options.workflowContext ? options.workflowContext : null;

    var localReadiness = evaluateSubmitReadiness({
      draft: draft,
      selectedFolder: selectedFolder,
      missingTopLevelFolders: missingTopLevelFolders,
      qcPassed: qcPassed,
      isSubmitting: isSubmitting,
    });

    if (workflowContext && localReadiness.canSubmit) {
      var workflowBlockers = mapWorkflowBlockersToReadiness(workflowContext);
      if (workflowBlockers.length > 0) {
        return { canSubmit: false, blockers: workflowBlockers };
      }
    } else if (workflowContext && !localReadiness.canSubmit) {
      var airtableBlockers = mapWorkflowBlockersToReadiness(workflowContext);
      if (airtableBlockers.length > 0) {
        var localCodes = localReadiness.blockers.map(function (b) { return b.code; });
        var newBlockers = airtableBlockers.filter(function (ab) {
          return localCodes.indexOf(ab.code) === -1;
        });
        if (newBlockers.length > 0) {
          return {
            canSubmit: false,
            blockers: newBlockers.concat(localReadiness.blockers),
          };
        }
      }
    }

    return localReadiness;
  }

  function resolveSubmitGateStatus(options) {
    var draft = options && options.draft ? options.draft : {};
    var submissionId = options && typeof options.submissionId === 'string'
      ? options.submissionId
      : '';
    var selectedFolder = options && options.selectedFolder ? options.selectedFolder : null;
    var hasFolder = Boolean(selectedFolder && selectedFolder.path);
    var missingFolders = Array.isArray(options && options.missingFolders) ? options.missingFolders : [];
    var qcPassedBySubmissionId = options && options.qcPassedBySubmissionId
      ? options.qcPassedBySubmissionId
      : {};
    var qcPassed = Boolean(submissionId && qcPassedBySubmissionId[submissionId] === true);
    var isSubmitting = Boolean(options && options.isSubmitting);
    var metadataComplete = getMissingMetadataFields(draft).length === 0 && hasValidReleaseMonth(draft.releaseMonth);

    var gates = [
      {
        id: 'metadata',
        label: 'Metadata complete (Pack Name, Label Name, Release Month)',
        passed: metadataComplete,
        blockingMessage: 'Complete Pack Name, Label Name, and Release Month (YYYY-MM) first.',
      },
      {
        id: 'folder-selected',
        label: 'Pack folder selected',
        passed: hasFolder,
        blockingMessage: 'Select a pack folder before submitting.',
      },
      {
        id: 'required-folders',
        label: 'Required top-level folders present',
        passed: missingFolders.length === 0,
        blockingMessage: (
          buildStructureGateMessage(missingFolders) + ' ' +
          buildMissingRequiredFolderGuidance(missingFolders)
        ),
      },
      {
        id: 'qc-passed',
        label: 'QC run has zero blocking findings',
        passed: qcPassed,
        blockingMessage: 'Run QC and resolve blocking findings before submitting for review.',
      },
      {
        id: 'not-submitting',
        label: 'No active submit in progress',
        passed: !isSubmitting,
        blockingMessage: 'Submission is already in progress.',
      },
    ];

    var blockedGate = gates.find(function (gate) { return gate.passed !== true; }) || null;

    return {
      submissionId: submissionId,
      gates: gates,
      canSubmit: blockedGate === null,
      blockedGateId: blockedGate ? blockedGate.id : '',
      blockingMessage: blockedGate ? blockedGate.blockingMessage : '',
      missingFolders: missingFolders.slice(),
      hasFolder: hasFolder,
    };
  }

  function resolveDraftFocusTargetForReadiness(readiness, packName, labelName) {
    var blockers = readiness && Array.isArray(readiness.blockers) ? readiness.blockers : [];
    if (!blockers.length) {
      return 'workspace-submit-review';
    }
    var first = blockers[0];
    if (!first || !first.code) {
      return 'workspace-save-metadata';
    }
    if (first.code === 'metadata_incomplete' || first.code === 'release_month_format_invalid') {
      if (!packName) { return 'workspace-pack-name'; }
      if (!labelName) { return 'workspace-label-name'; }
      return 'workspace-release-month';
    }
    if (first.code === 'pack_folder_missing' || first.code === 'pack_folder_empty' || first.code === 'required_folders_missing') {
      return 'workspace-select-pack-folder';
    }
    if (
      first.code === 'airtable_incomplete' ||
      first.code === 'airtable_checksum_missing' ||
      first.code === 'airtable_link_unverified' ||
      first.code === 'airtable_not_linked'
    ) {
      return 'workspace-airtable-complete';
    }
    if (first.code === 'qc_not_passed') {
      return 'workspace-run-qc';
    }
    if (first.code === 'submit_in_progress') {
      return 'workspace-submit-review';
    }
    return 'workspace-save-metadata';
  }

  return {
    resolveMissingRequiredFolders: resolveMissingRequiredFolders,
    buildStructureGateMessage: buildStructureGateMessage,
    buildMissingRequiredFolderGuidance: buildMissingRequiredFolderGuidance,
    resolveTopLevelFolderChecklist: resolveTopLevelFolderChecklist,
    getMissingMetadataFields: getMissingMetadataFields,
    hasValidReleaseMonth: hasValidReleaseMonth,
    evaluateSubmitReadiness: evaluateSubmitReadiness,
    mapWorkflowBlockersToReadiness: mapWorkflowBlockersToReadiness,
    buildCanonicalReadiness: buildCanonicalReadiness,
    resolveSubmitGateStatus: resolveSubmitGateStatus,
    resolveDraftFocusTargetForReadiness: resolveDraftFocusTargetForReadiness
  };
});
