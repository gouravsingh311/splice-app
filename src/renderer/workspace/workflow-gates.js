(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceWorkflowGates = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var STEP_IDS = Object.freeze(['airtable', 'intake', 'qc', 'review']);

  function normalizeSyncStatus(value) {
    var normalized = String(value || '').trim().toLowerCase();
    return normalized || null;
  }

  function isMetadataComplete(draft) {
    if (!draft || typeof draft !== 'object') {
      return false;
    }
    return Boolean(draft.packName && draft.labelName && draft.releaseMonth);
  }

  function buildContext(input) {
    var draft = input && input.draft ? input.draft : {};
    var hasFolder = Boolean(input && input.hasFolder);
    var isSubmitting = Boolean(input && input.isSubmitting);
    var missingRequiredFolders = Array.isArray(input && input.missingRequiredFolders)
      ? input.missingRequiredFolders
      : [];

    var airtable = input && input.airtable ? input.airtable : {};
    var airtableFormCompleted = Boolean(airtable.formCompleted);
    var airtablePayloadChecksum = String(airtable.payloadChecksum || '').trim();
    var airtableSyncStatus = normalizeSyncStatus(airtable.syncStatus);
    var airtableLinkedKnown = airtableSyncStatus !== null;
    var airtableLinked = airtableSyncStatus === 'linked';

    var submissionId = String(draft.submissionId || '').trim();
    var metadataComplete = isMetadataComplete(draft);
    var qcPassed = Boolean(input && input.qcPassed);

    var stepAirtableComplete = airtableFormCompleted && Boolean(airtablePayloadChecksum) && airtableLinked;
    var stepIntakeComplete = metadataComplete && hasFolder && missingRequiredFolders.length === 0;
    var stepQcComplete = qcPassed;

    var blockers = [];

    if (!metadataComplete) {
      blockers.push('Complete Pack Name, Label Name, and Release Month first.');
    }
    if (!airtableFormCompleted) {
      blockers.push('Complete Airtable Submission Details before submitting.');
    }
    if (!airtablePayloadChecksum) {
      blockers.push('Finish Airtable Submission Details before submitting.');
    }
    if (!airtableLinkedKnown) {
      blockers.push('We could not confirm Airtable details yet. Next step: sync Airtable details again.');
    } else if (!airtableLinked) {
      blockers.push('Airtable details still need attention before submitting. Next step: sync Airtable details again.');
    }
    if (!hasFolder) {
      blockers.push('Select a pack folder before submitting.');
    }
    if (missingRequiredFolders.length > 0) {
      blockers.push('Required top-level folders are missing: ' + missingRequiredFolders.join(', ') + '.');
    }
    if (!qcPassed) {
      blockers.push('Run QC successfully before submitting for review.');
    }
    if (!submissionId) {
      blockers.push('Save draft metadata to create a submission before submitting.');
    }
    if (isSubmitting) {
      blockers.push('Submission is already in progress.');
    }

    var activeStep = 'review';
    if (!stepAirtableComplete) {
      activeStep = 'airtable';
    } else if (!stepIntakeComplete) {
      activeStep = 'intake';
    } else if (!stepQcComplete) {
      activeStep = 'qc';
    }

    return {
      submissionId: submissionId,
      metadataComplete: metadataComplete,
      qcPassed: qcPassed,
      hasFolder: hasFolder,
      missingRequiredFolders: missingRequiredFolders,
      isSubmitting: isSubmitting,
      airtableFormCompleted: airtableFormCompleted,
      airtablePayloadChecksum: airtablePayloadChecksum,
      airtableSyncStatus: airtableSyncStatus,
      airtableLinkedKnown: airtableLinkedKnown,
      airtableLinked: airtableLinked,
      stepAirtableComplete: stepAirtableComplete,
      stepIntakeComplete: stepIntakeComplete,
      stepQcComplete: stepQcComplete,
      blockers: blockers,
      canSubmit: blockers.length === 0,
      activeStep: activeStep,
    };
  }

  function buildStepState(context) {
    var current = context && context.activeStep ? context.activeStep : 'airtable';
    var complete = {
      airtable: Boolean(context && context.stepAirtableComplete),
      intake: Boolean(context && context.stepIntakeComplete),
      qc: Boolean(context && context.stepQcComplete),
      review: Boolean(context && context.canSubmit),
    };

    return STEP_IDS.map(function (stepId) {
      var status = 'pending';
      if (complete[stepId]) {
        status = 'done';
      } else if (stepId === current) {
        status = 'active';
      }
      return {
        id: stepId,
        status: status,
      };
    });
  }

  return {
    STEP_IDS: STEP_IDS,
    isMetadataComplete: isMetadataComplete,
    buildContext: buildContext,
    buildStepState: buildStepState,
  };
});
