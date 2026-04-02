/* Creator Workspace (PRD-02) */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.creatorWorkspacePage = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var packStructure = (
    typeof globalThis !== 'undefined' &&
    globalThis.workspacePackStructure &&
    typeof globalThis.workspacePackStructure === 'object'
  ) ? globalThis.workspacePackStructure : null;
  var workflowGates = (
    typeof globalThis !== 'undefined' &&
    globalThis.workspaceWorkflowGates &&
    typeof globalThis.workspaceWorkflowGates === 'object'
  ) ? globalThis.workspaceWorkflowGates : null;
  var PHASE1_REQUIRED_FOLDER_COPY = packStructure && packStructure.REQUIRED_FOLDERS_PHASE1_COPY
    ? packStructure.REQUIRED_FOLDERS_PHASE1_COPY
    : (
      'Phase 1 requires top-level folders: Audio, Artwork/Cover Art, Demo/Demos, ' +
      'Description/Description & Info. Presets and MIDI are optional.'
    );
  var workspaceStateModule = (
    typeof globalThis !== 'undefined' &&
    globalThis.workspaceState &&
    typeof globalThis.workspaceState === 'object'
  ) ? globalThis.workspaceState : null;
  
  var state = workspaceStateModule ? workspaceStateModule.get() : {
    submissions: [],
    selectedSubmissionId: null,
    selectedTimeline: [],
    timelinesBySubmissionId: {},
    draft: {
      submissionId: '',
      packName: '',
      labelName: '',
      releaseMonth: '',
      notes: '',
      tags: [],
    },
    airtable: {
      formCompleted: false,
      payloadChecksum: '',
      syncStatus: null,
      recordId: '',
      recordUrl: '',
      lastSyncedAt: '',
      lastErrorCode: '',
      lastErrorDetail: '',
      mappedPayload: null,
    },
    profile: null,
    qcPassed: {},
    qcResults: {},
    mode: 'list',
    uiViewStep: 'airtable',
    selectedFolder: null,
    missingTopLevelFolders: [],
    isSubmitting: false,
    isQcRunning: false,
    qcRunStatus: null,
    activeUpload: null,
    uploadPollTimer: null,
    uploadProgress: 0,
    uploadStatus: '',
    uploadUploadedBytes: 0,
    uploadTotalBytes: 0,
    uploadUploadedFiles: 0,
    uploadTotalFiles: 0,
    uploadError: '',
    uploadUpdatedAt: '',
    uploadControlInFlight: '',
    pendingShortcut: '',
    isLoadingSubmissions: false,
    autosaveTimer: null,
    pendingFocusTargetId: '',
  };

  var r = globalThis.workspaceReadiness;
  if (!r && typeof require === 'function') {
    try { r = require('../features/workspace/utils/readiness.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceReadiness', e); }
  }
  r = r || {};

  var q = globalThis.workspaceQcFindings;
  if (!q && typeof require === 'function') {
    try { q = require('../features/workspace/utils/qc-findings.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceQcFindings', e); }
  }
  q = q || {};

  var m = globalThis.workspaceMarkup;
  if (!m && typeof require === 'function') {
    try { m = require('../features/workspace/utils/markup.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceMarkup', e); }
  }
  m = m || {};

  var resolveMissingRequiredFolders = r.resolveMissingRequiredFolders;
  var buildStructureGateMessage = r.buildStructureGateMessage;
  var buildMissingRequiredFolderGuidance = r.buildMissingRequiredFolderGuidance;
  var resolveTopLevelFolderChecklist = r.resolveTopLevelFolderChecklist;
  
  var escapeHtml = m.escapeHtml;
  var getQcCatalogApi = q.getQcCatalogApi;
  var inferQcCategoryFromRuleId = q.inferQcCategoryFromRuleId;
  var formatQcSize = q.formatQcSize;
  var extractFindingFileRef = q.extractFindingFileRef;
  var normalizeFindingSeverity = q.normalizeFindingSeverity;
  var compareFindings = q.compareFindings;
  var normalizeQcFinding = q.normalizeQcFinding;
  var normalizeQcFindings = q.normalizeQcFindings;
  
  var getMissingMetadataFields = r.getMissingMetadataFields;
  var hasValidReleaseMonth = r.hasValidReleaseMonth;
  var evaluateSubmitReadiness = r.evaluateSubmitReadiness;
  var mapWorkflowBlockersToReadiness = r.mapWorkflowBlockersToReadiness;
  var buildCanonicalReadiness = r.buildCanonicalReadiness;
  var resolveSubmitGateStatus = r.resolveSubmitGateStatus;
  
  var buildSubmitBlockedFeedbackMessage = m.buildSubmitBlockedFeedbackMessage;
  var buildReadinessSummaryText = m.buildReadinessSummaryText;
  var buildReadinessBlockersMarkup = m.buildReadinessBlockersMarkup;
  var buildCreatorRemediationItems = m.buildCreatorRemediationItems;
  var buildRemediationSummaryText = m.buildRemediationSummaryText;
  var buildRemediationMarkup = m.buildRemediationMarkup;
  var buildQcRunStatusMarkup = m.buildQcRunStatusMarkup;
  var resolveDraftFocusTargetForReadiness = r.resolveDraftFocusTargetForReadiness;


  function toCreatorSafeSurfaceMessage(context, rawMessage) {
    var message = String(rawMessage || '').trim();
    if (!message) {
      if (context === 'qc') { return 'QC is temporarily unavailable. Please try again in a moment.'; }
      if (context === 'submit') { return 'Submit is temporarily unavailable. Your draft is still safe; please try again.'; }
      if (context === 'metadata') { return 'Could not save metadata right now. Please try again.'; }
      return 'Something went wrong. Please try again.';
    }
    if (isBackendUnavailableMessage(message)) {
      if (context === 'qc') {
        return 'QC backend is unreachable. Start the API service, then rerun QC.';
      }
      if (context === 'submit') {
        return 'Submit paused because backend is unreachable. Your draft is safe; retry when API service is back.';
      }
      if (context === 'metadata') {
        return 'Metadata sync is unavailable because backend is unreachable. Retry after API recovery.';
      }
      return 'Backend is unreachable. Retry after API recovery.';
    }
    if (/qc_policy|expected_policy_version|policy version|version conflict|fileeaters\.admin|admin\./i.test(message)) {
      if (context === 'qc') { return 'QC could not finish. Next step: try Run QC again in a moment.'; }
      if (context === 'submit') { return 'Your submission did not go through. Next step: wait a moment, then click Submit for Review again.'; }
      return 'Could not complete that action right now. Next step: try again in a moment.';
    }
    if (/econnrefused|backend_unreachable|network error|fetch failed|timeout|ipc|unknown_channel|validation_error/i.test(message)) {
      if (context === 'qc') { return 'QC is temporarily unavailable. Please try again in a moment.'; }
      if (context === 'submit') { return 'Submit is temporarily unavailable. Your draft is still safe; please try again.'; }
      if (context === 'metadata') { return 'Could not save your draft right now. Please try again.'; }
      return 'Could not complete that action right now. Please try again.';
    }
    return message;
  }

  function logWorkspaceOptionalDependencyFailure(moduleName, error) {
    var detail = error && error.message ? error.message : String(error || 'unknown error');
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('[workspace-page] Optional dependency failed to load: ' + moduleName, detail);
    }
  }

  async function digestSha256Hex(value) {
    var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    var subtle = typeof globalThis !== 'undefined' && globalThis.crypto ? globalThis.crypto.subtle : null;
    if (!encoder || !subtle || typeof subtle.digest !== 'function') {
      throw new Error('SHA-256 hashing is unavailable in this renderer context.');
    }
    var input = encoder.encode(String(value || ''));
    var digest = await subtle.digest('SHA-256', input);
    return Array.from(new Uint8Array(digest))
      .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
      .join('');
  }

  function buildManifestFileHashSource(entry) {
    return [
      String(entry.relativePath || '').trim().replace(/\\/g, '/'),
      String(Math.max(1, Number(entry.sizeBytes || 1))),
      String(entry.mimeType || 'application/octet-stream').trim().toLowerCase(),
      String(entry.category || inferCategoryFromPath(entry.relativePath)).trim().toLowerCase(),
      entry.requiredAsset ? '1' : '0',
    ].join('\u001f');
  }

  async function buildManifestChecksum(files) {
    var canonicalEntries = (Array.isArray(files) ? files : [])
      .slice()
      .sort(function (a, b) {
        return String(a.relativePath || '').localeCompare(String(b.relativePath || ''));
      })
      .map(function (entry) {
        return [
          String(entry.relativePath || '').trim().replace(/\\/g, '/'),
          String(Math.max(1, Number(entry.sizeBytes || 1))),
          String(entry.sha256 || '').trim().toLowerCase(),
          String(entry.mimeType || 'application/octet-stream').trim().toLowerCase(),
          String(entry.category || '').trim().toLowerCase(),
          entry.requiredAsset ? '1' : '0',
        ].join('\u001f');
      })
      .join('\u001e');
    return digestSha256Hex(canonicalEntries);
  }

  function ipc() {
    if (typeof window === 'undefined') { return null; }
    return window.electronAPI || window.fileeaters || null;
  }

  function getActorId() {
    var actorEl = document.getElementById('actor-id');
    if (!actorEl) { return 'desktop-local'; }
    var value = String(actorEl.textContent || '').trim();
    return value && value !== '—' ? value : 'desktop-local';
  }

  function getActorRole() {
    var rolesEl = document.getElementById('actor-roles');
    if (!rolesEl) { return 'creator'; }
    var value = String(rolesEl.textContent || '').trim().toLowerCase();
    if (!value || value === '—') { return 'creator'; }
    return value.split(',')[0].trim() || 'creator';
  }

  function showFeedback(tone, message) {
    var target = document.getElementById('workspace-feedback');
    if (!target) { return; }

    if (!message) {
      target.className = 'auth-feedback hidden';
      target.textContent = '';
      target.setAttribute('aria-live', 'polite');
      target.setAttribute('role', 'status');
      return;
    }

    var normalizedTone = String(tone || '').toLowerCase();
    target.className = 'auth-feedback ' + (tone || '');
    target.textContent = message;
    target.setAttribute('aria-live', normalizedTone === 'error' ? 'assertive' : 'polite');
    target.setAttribute('role', normalizedTone === 'error' ? 'alert' : 'status');
    if (normalizedTone === 'warning' || normalizedTone === 'error') {
      target.focus();
    }
  }

  function focusElementById(id) {
    if (typeof document === 'undefined') { return; }
    var target = document.getElementById(id);
    if (!target || typeof target.focus !== 'function') { return; }
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus();
  }

  function scheduleFocusTarget(targetId) {
    if (workspaceStateModule && typeof workspaceStateModule.scheduleFocusTarget === 'function') {
      workspaceStateModule.scheduleFocusTarget(targetId);
    } else {
      state.pendingFocusTargetId = String(targetId || '').trim();
    }
  }

  function applyPendingFocusTarget() {
    if (workspaceStateModule && typeof workspaceStateModule.applyPendingFocusTarget === 'function') {
      workspaceStateModule.applyPendingFocusTarget();
      return;
    }
    if (!state.pendingFocusTargetId) {
      return;
    }
    var targetId = state.pendingFocusTargetId;
    state.pendingFocusTargetId = '';
    focusElementById(targetId);
  }


  function isBackendUnavailableMessage(message) {
    var normalized = String(message || '').toLowerCase();
    return (
      normalized.indexOf('backend is unreachable') !== -1 ||
      normalized.indexOf('backend is unavailable') !== -1 ||
      normalized.indexOf('backend_unreachable') !== -1 ||
      normalized.indexOf('econnrefused') !== -1 ||
      normalized.indexOf('ecconnrefused') !== -1 ||
      normalized.indexOf('timeout') !== -1 ||
      normalized.indexOf('network') !== -1 ||
      normalized.indexOf('fetch') !== -1 ||
      normalized.indexOf('unreachable') !== -1
    );
  }

  function isBackendUnavailableError(errorLike) {
    var message = String((errorLike && errorLike.message) || '').toLowerCase();
    var reason = String((errorLike && errorLike.reason) || '').toLowerCase();
    return (
      isBackendUnavailableMessage(message) ||
      reason.indexOf('backend_unreachable') !== -1
    );
  }

  var nav = globalThis.workspaceWizardNav;
  if (!nav && typeof require === 'function') {
    try { nav = require('../features/workspace/components/wizard-nav.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceWizardNav', e); }
  }

  var airtableStep = globalThis.workspaceAirtableStep;
  if (!airtableStep && typeof require === 'function') {
    try { airtableStep = require('../features/workspace/components/airtable-step.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceAirtableStep', e); }
  }

  var intakeStep = globalThis.workspaceIntakeStep;
  if (!intakeStep && typeof require === 'function') {
    try { intakeStep = require('../features/workspace/components/intake-step.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceIntakeStep', e); }
  }

  var reviewStep = globalThis.workspaceReviewStep;
  if (!reviewStep && typeof require === 'function') {
    try { reviewStep = require('../features/workspace/components/review-step.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceReviewStep', e); }
  }

  var submissionDetailComp = globalThis.workspaceSubmissionDetail;
  if (!submissionDetailComp && typeof require === 'function') {
    try { submissionDetailComp = require('../features/workspace/components/submission-detail.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceSubmissionDetail', e); }
  }
  submissionDetailComp = submissionDetailComp || {};

  var historyPanel = globalThis.workspaceHistoryPanel;
  if (!historyPanel && typeof require === 'function') {
    try { historyPanel = require('../features/workspace/components/history-panel.js'); } catch (e) { logWorkspaceOptionalDependencyFailure('workspaceHistoryPanel', e); }
  }
  historyPanel = historyPanel || {};

  // --- HTML Build helpers (from workspace-page) ---

  function buildReleaseMonthOptions(selectedValue) {
    var now = new Date();
    var options = [];
    var seen = {};
    var i;
    for (i = 0; i < 18; i += 1) {
      var dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      var year = dt.getUTCFullYear();
      var month = String(dt.getUTCMonth() + 1).padStart(2, '0');
      var value = year + '-' + month;
      seen[value] = true;
      options.push('<option value="' + value + '">' + value + '</option>');
    }
    var normalizedSelected = String(selectedValue || '').trim();
    if (hasValidReleaseMonth(normalizedSelected) && !seen[normalizedSelected]) {
      options.unshift('<option value="' + normalizedSelected + '">' + normalizedSelected + '</option>');
    }
    return options.join('');
  }

  // Delegate to extracted component helpers
  function statusChip(status) {
    return submissionDetailComp.statusChip ? submissionDetailComp.statusChip(status) :
      (function () {
        var safe = String(status || 'draft').toLowerCase();
        return '<span class="fe-status-chip ' + (safe === 'under_review' ? 'under-review' : safe) + '">' + safe.replace('_', ' ') + '</span>';
      }());
  }

  function hasRejectedLifecycleEvent(timeline) {
    var i;
    if (!Array.isArray(timeline)) { return false; }
    for (i = 0; i < timeline.length; i += 1) {
      if (String(timeline[i] && timeline[i].toState ? timeline[i].toState : '').toLowerCase() === 'rejected') {
        return true;
      }
    }
    return false;
  }

  function hasDraftAfterRejectedLifecycleEvent(timeline) {
    var i;
    var seenRejected = false;
    if (!Array.isArray(timeline)) { return false; }
    for (i = 0; i < timeline.length; i += 1) {
      var toState = String(timeline[i] && timeline[i].toState ? timeline[i].toState : '').toLowerCase();
      if (toState === 'rejected') {
        seenRejected = true;
      }
      if (seenRejected && toState === 'draft') {
        return true;
      }
    }
    return false;
  }

  function resolveNeedsActionDescriptor(submission, timeline) {
    var currentState = String(submission && submission.currentState ? submission.currentState : '').toLowerCase();
    if (currentState === 'rejected') {
      return {
        needsAction: true,
        kind: 'rejected',
        label: 'Needs Action',
      };
    }
    if (currentState === 'draft' && hasDraftAfterRejectedLifecycleEvent(timeline)) {
      return {
        needsAction: true,
        kind: 'reopened',
        label: 'Needs Action',
      };
    }
    return {
      needsAction: false,
      kind: 'none',
      label: '',
    };
  }

  function resolveNeedsActionTargetSubmissionId(submissions, timelinesBySubmissionId) {
    var ranked = (Array.isArray(submissions) ? submissions : [])
      .map(function (submission) {
        var timeline = timelinesBySubmissionId && submission
          ? timelinesBySubmissionId[submission.submissionId]
          : [];
        var descriptor = resolveNeedsActionDescriptor(submission, timeline);
        var priority = descriptor.kind === 'reopened' ? 0 : descriptor.kind === 'rejected' ? 1 : 9;
        return {
          submissionId: submission ? submission.submissionId : '',
          needsAction: descriptor.needsAction,
          priority: priority,
          updatedAt: Date.parse(submission && (submission.updatedAt || submission.createdAt || '')) || 0,
        };
      })
      .filter(function (item) { return item.needsAction && item.submissionId; })
      .sort(function (a, b) {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return b.updatedAt - a.updatedAt;
      });

    return ranked.length > 0 ? ranked[0].submissionId : '';
  }

  function buildNeedsActionBadge(descriptor) {
    if (!descriptor || descriptor.needsAction !== true) {
      return '';
    }
    return '<span class="ml-2 inline-flex items-center rounded-full border border-brand-danger px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-danger">Needs Action</span>';
  }

  function resolveLifecycleVisibility(submission, timeline) {
    var currentState = String(submission && submission.currentState ? submission.currentState : '').toLowerCase();
    var needsAction = resolveNeedsActionDescriptor(submission, timeline);

    if (needsAction.kind === 'rejected') {
      return {
        toneClass: 'auth-feedback warning',
        heading: 'Rejected: awaiting reviewer/admin reopen',
        message: 'Re-open is reviewer/admin-controlled. Next step: track lifecycle updates here; once reopened, continue edits in this submissions workflow.',
        showEditAction: false,
        actionLabel: '',
      };
    }

    if (needsAction.kind === 'reopened') {
      return {
        toneClass: 'auth-feedback success',
        heading: 'Reopened for amendment',
        message: 'This submission is reopened and editable. Next step: continue metadata, intake, QC remediation, then resubmit from this workflow.',
        showEditAction: true,
        actionLabel: 'Continue Reopened Draft',
      };
    }

    if (currentState === 'draft') {
      return {
        toneClass: 'auth-subtle',
        heading: 'Draft in progress',
        message: 'Next step: continue preparing this draft inside submissions.',
        showEditAction: true,
        actionLabel: 'Continue Draft',
      };
    }

    if (currentState === 'under_review') {
      return {
        toneClass: 'auth-subtle',
        heading: 'Under review',
        message: 'Reviewer decisions and lifecycle changes will appear in this timeline. Next step: monitor this submission until a decision is posted.',
        showEditAction: false,
        actionLabel: '',
      };
    }

    return {
      toneClass: 'auth-subtle',
      heading: 'Lifecycle status',
      message: 'Status history and detail stay consolidated in submissions. Next step: review the latest timeline event and follow the linked workflow action.',
      showEditAction: false,
      actionLabel: '',
    };
  }

  function getSubmissionById(submissionId) {
    var i;
    if (!submissionId || !Array.isArray(state.submissions)) {
      return null;
    }
    for (i = 0; i < state.submissions.length; i += 1) {
      if (state.submissions[i] && state.submissions[i].submissionId === submissionId) {
        return state.submissions[i];
      }
    }
    return null;
  }

  function normalizeSubmissionsShortcutDetail(detail) {
    var payload = detail;
    if (typeof payload === 'string') {
      payload = { shortcut: payload };
    }
    payload = payload && typeof payload === 'object' ? payload : {};
    return {
      shortcut: String(payload.shortcut || '').trim().toLowerCase(),
      submissionId: String(payload.submissionId || payload.targetSubmissionId || '').trim(),
      submissionMode: String(payload.submissionMode || payload.targetMode || '').trim().toLowerCase(),
      sourceView: String(payload.sourceView || payload.source || '').trim(),
    };
  }

  function resolveSubmissionLaunchMode(submission, explicitMode) {
    var currentState = String(submission && submission.currentState ? submission.currentState : '').trim().toLowerCase();
    var normalizedExplicitMode = String(explicitMode || '').trim().toLowerCase();
    if (currentState === 'draft') {
      return 'draft';
    }
    if (currentState === 'uploading') {
      return 'draft';
    }
    if (normalizedExplicitMode === 'draft') {
      return 'draft';
    }
    return 'detail';
  }

  function resolveDraftRestoreStep(submission, options) {
    var submissionId = submission ? submission.submissionId : '';
    var qcPassedOverride = options && Object.prototype.hasOwnProperty.call(options, 'qcPassed')
      ? Boolean(options.qcPassed)
      : null;
    var hasAirtableDetails = Boolean(
      submission &&
      (submission.airtableFormCompleted ||
        submission.airtablePayloadChecksum ||
        submission.airtableSyncStatus ||
        submission.airtableRecordId ||
        submission.airtableRecordUrl)
    );
    var qcPassed = qcPassedOverride === null
      ? Boolean(submissionId && state.qcPassed[submissionId] === true)
      : qcPassedOverride;

    if (qcPassed) {
      return 'review';
    }
    if (String(submission && submission.currentState ? submission.currentState : '').trim().toLowerCase() === 'uploading') {
      return 'review';
    }
    if (hasAirtableDetails) {
      return 'intake';
    }
    return 'airtable';
  }

  function readDraftForm() {
    var packNameEl = document.getElementById('workspace-pack-name');
    var labelNameEl = document.getElementById('workspace-label-name');
    var releaseMonthEl = document.getElementById('workspace-release-month');
    var notesEl = document.getElementById('workspace-notes');
    var tagsEl = document.getElementById('workspace-tags');

    var tags = String(tagsEl && tagsEl.value ? tagsEl.value : '')
      .split(',')
      .map(function (tag) { return tag.trim(); })
      .filter(Boolean);

    return {
      submissionId: state.draft.submissionId,
      packName: String(packNameEl && packNameEl.value ? packNameEl.value : '').trim(),
      labelName: String(labelNameEl && labelNameEl.value ? labelNameEl.value : '').trim(),
      releaseMonth: String(releaseMonthEl && releaseMonthEl.value ? releaseMonthEl.value : '').trim(),
      notes: String(notesEl && notesEl.value ? notesEl.value : '').trim(),
      tags: tags,
    };
  }

  function mergeDraftState(currentDraft, nextDraft) {
    var base = currentDraft || {};
    var incoming = nextDraft || {};
    return {
      submissionId: String(incoming.submissionId || base.submissionId || ''),
      packName: String(incoming.packName || base.packName || '').trim(),
      labelName: String(incoming.labelName || base.labelName || '').trim(),
      releaseMonth: String(incoming.releaseMonth || base.releaseMonth || '').trim(),
      notes: String(incoming.notes || base.notes || '').trim(),
      tags: Array.isArray(incoming.tags) && incoming.tags.length > 0 ? incoming.tags.slice() : (Array.isArray(base.tags) ? base.tags.slice() : []),
    };
  }

  function syncDraftStateFromForm() {
    state.draft = mergeDraftState(state.draft, readDraftForm());
    return state.draft;
  }

  function isMetadataComplete(draft) {
    return Boolean(draft.packName && draft.labelName && hasValidReleaseMonth(draft.releaseMonth));
  }

  function validateDraft(draft) {
    if (!draft.packName) { return 'Pack Name is required.'; }
    if (!draft.labelName) { return 'Label Name is required.'; }
    if (!hasValidReleaseMonth(draft.releaseMonth)) {
      return 'Release Month must be YYYY-MM.';
    }
    return '';
  }

  function fallbackBuildWorkflowContext(input) {
    var missingRequiredFolders = Array.isArray(input.missingRequiredFolders) ? input.missingRequiredFolders : [];
    var metadataComplete = isMetadataComplete(input.draft);
    var airtable = input.airtable || {};
    var airtableFormCompleted = Boolean(airtable.formCompleted);
    var airtablePayloadChecksum = String(airtable.payloadChecksum || '').trim();
    var hasFolder = Boolean(input.hasFolder);
    var qcPassed = Boolean(input.qcPassed);
    var blockers = [];

    if (!metadataComplete) { blockers.push('Complete Pack Name, Label Name, and Release Month first.'); }
    if (!airtableFormCompleted) { blockers.push('Complete Airtable Submission Details before submitting.'); }
    if (!airtablePayloadChecksum) { blockers.push('Finish Airtable Submission Details before submitting.'); }
    if (!hasFolder) { blockers.push('Select a pack folder before submitting.'); }
    if (missingRequiredFolders.length > 0) {
      blockers.push('Required top-level folders are missing: ' + missingRequiredFolders.join(', ') + '.');
    }
    if (!qcPassed) { blockers.push('Run QC successfully before submitting for review.'); }
    if (!input.draft || !input.draft.submissionId) {
      blockers.push('Save draft metadata to create a submission before submitting.');
    }
    if (input.isSubmitting) { blockers.push('Submission is already in progress.'); }

    return {
      blockers: blockers,
      canSubmit: blockers.length === 0,
      activeStep: blockers.length > 0 && !airtableFormCompleted ? 'airtable' : (qcPassed ? 'review' : 'qc'),
      stepAirtableComplete: airtableFormCompleted && Boolean(airtablePayloadChecksum),
      stepIntakeComplete: metadataComplete && hasFolder && missingRequiredFolders.length === 0,
      stepQcComplete: qcPassed,
      airtableFormCompleted: airtableFormCompleted,
      airtablePayloadChecksum: airtablePayloadChecksum,
      airtableLinkedKnown: false,
      airtableLinked: true,
    };
  }

  function buildWorkflowContext(draft) {
    var hasFolder = Boolean(state.selectedFolder && state.selectedFolder.path);
    var submissionId = state.draft && state.draft.submissionId ? state.draft.submissionId : '';
    var qcPassed = submissionId ? state.qcPassed[submissionId] === true : false;
    var input = {
      draft: draft || state.draft,
      airtable: state.airtable,
      hasFolder: hasFolder,
      missingRequiredFolders: state.missingTopLevelFolders || [],
      qcPassed: qcPassed,
      isSubmitting: state.isSubmitting,
    };

    if (workflowGates && typeof workflowGates.buildContext === 'function') {
      return workflowGates.buildContext(input);
    }
    return fallbackBuildWorkflowContext(input);
  }

  function buildAirtableChecksum(draft) {
    var safeDraft = draft || state.draft;
    return [
      String(safeDraft.packName || '').trim(),
      String(safeDraft.labelName || '').trim(),
      String(safeDraft.releaseMonth || '').trim(),
      String(safeDraft.notes || '').trim(),
      Array.isArray(safeDraft.tags) ? safeDraft.tags.join('|') : '',
    ].join('::');
  }

  function hydrateAirtableStateFromSubmission(submission) {
    var record = submission || {};
    var status = record.airtableSyncStatus == null ? null : String(record.airtableSyncStatus || '').trim().toLowerCase();
    state.airtable = {
      formCompleted: Boolean(record.airtableFormCompleted),
      payloadChecksum: String(record.airtablePayloadChecksum || ''),
      syncStatus: status || null,
      recordId: String(record.airtableRecordId || ''),
      recordUrl: String(record.airtableRecordUrl || ''),
      lastSyncedAt: String(record.airtableLastSyncedAt || ''),
      lastErrorCode: String(record.airtableLastErrorCode || ''),
      lastErrorDetail: String(record.airtableLastErrorDetail || ''),
      mappedPayload: null,
    };
  }

  function resolveSubmissionExpectedVersion(submissionId) {
    if (!submissionId || !Array.isArray(state.submissions)) {
      return undefined;
    }
    for (var i = 0; i < state.submissions.length; i += 1) {
      var submission = state.submissions[i];
      if (!submission || submission.submissionId !== submissionId) {
        continue;
      }
      if (Number.isInteger(submission.version) && submission.version >= 0) {
        return submission.version;
      }
      var coerced = Number.parseInt(String(submission.version || ''), 10);
      if (Number.isInteger(coerced) && coerced >= 0) {
        return coerced;
      }
      return undefined;
    }
    return undefined;
  }

  function setUploadProgress(percent, statusText) {
    state.uploadProgress = Math.max(0, Math.min(100, Math.round(percent)));
    state.uploadStatus = statusText || '';
    if (state.activeUpload) {
      state.activeUpload = Object.assign({}, state.activeUpload, {
        progressPercent: state.uploadProgress,
        statusText: state.uploadStatus,
      });
    }
    renderMainPanel();
  }

  function getActiveUploadStorageKey() {
    return 'fileeaters.workspace.active-upload.v1';
  }

  function getDraftContextStorageKey(submissionId) {
    return 'fileeaters.workspace.draft-context.v1:' + String(submissionId || '').trim();
  }

  function persistDraftContext(submissionId) {
    if (!submissionId || typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      var folder = state.selectedFolder;
      window.localStorage.setItem(
        getDraftContextStorageKey(submissionId),
        JSON.stringify({
          selectedFolder: folder
            ? {
                path: String(folder.path || '').trim(),
                fileCount: coerceNonNegativeInteger(folder.fileCount, 0),
                topLevelFolders: Array.isArray(folder.topLevelFolders) ? folder.topLevelFolders : [],
                files: Array.isArray(folder.files)
                  ? folder.files.map(function (entry) {
                      return {
                        relativePath: String(entry && entry.relativePath ? entry.relativePath : '').trim(),
                        sizeBytes: coerceNonNegativeInteger(entry && entry.sizeBytes, 0),
                        mimeType: String(entry && entry.mimeType ? entry.mimeType : 'application/octet-stream').trim(),
                      };
                    }).filter(function (entry) { return entry.relativePath.length > 0; })
                  : [],
              }
            : null,
          missingTopLevelFolders: Array.isArray(state.missingTopLevelFolders) ? state.missingTopLevelFolders : [],
          qcPassed: Boolean(state.qcPassed[submissionId] === true),
          qcResult: state.qcResults[submissionId] || null,
        })
      );
    } catch (_error) {
      // Draft context persistence is best-effort only.
    }
  }

  function readDraftContext(submissionId) {
    if (!submissionId || typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    try {
      var raw = window.localStorage.getItem(getDraftContextStorageKey(submissionId));
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function normalizeUploadStatus(value) {
    var normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return '';
    }
    if (['queued', 'in_progress', 'paused', 'completed', 'failed', 'canceled'].indexOf(normalized) === -1) {
      return '';
    }
    return normalized;
  }

  function isActiveUploadStatus(value) {
    var status = normalizeUploadStatus(value);
    return status === 'queued' || status === 'in_progress';
  }

  function isTerminalUploadStatus(value) {
    var status = normalizeUploadStatus(value);
    return status === 'completed' || status === 'failed' || status === 'canceled';
  }

  function isPausedUploadStatus(value) {
    return normalizeUploadStatus(value) === 'paused';
  }

  function shouldSurfaceUploadStatus(value) {
    var status = normalizeUploadStatus(value);
    return status === 'queued' || status === 'in_progress' || status === 'paused' || status === 'failed';
  }

  function humanizeUploadStatus(status) {
    switch (normalizeUploadStatus(status)) {
      case 'queued':
        return 'Upload queued in the background';
      case 'in_progress':
        return 'Uploading files to Dropbox';
      case 'paused':
        return 'Upload paused';
      case 'completed':
        return 'Upload complete';
      case 'failed':
        return 'Upload failed';
      case 'canceled':
        return 'Upload canceled';
      default:
        return 'Preparing upload';
    }
  }

  function coerceNonNegativeInteger(value, fallback) {
    var parsed = Number.parseInt(String(value == null ? '' : value), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return fallback;
    }
    return parsed;
  }

  function readStoredActiveUploadState() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    try {
      var raw = window.localStorage.getItem(getActiveUploadStorageKey());
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      var status = normalizeUploadStatus(parsed.status);
      if (!status) {
        return null;
      }
      return {
        handoffId: String(parsed.handoffId || '').trim(),
        intakeSessionId: String(parsed.intakeSessionId || '').trim(),
        submissionId: String(parsed.submissionId || '').trim(),
        manifestVersion: coerceNonNegativeInteger(parsed.manifestVersion, null),
        status: status,
        progressPercent: coerceNonNegativeInteger(parsed.progressPercent, 0),
        uploadedBytes: coerceNonNegativeInteger(parsed.uploadedBytes, 0),
        totalBytes: coerceNonNegativeInteger(parsed.totalBytes, 0),
        uploadedFiles: coerceNonNegativeInteger(parsed.uploadedFiles, 0),
        totalFiles: coerceNonNegativeInteger(parsed.totalFiles, 0),
        error: String(parsed.error || '').trim(),
        updatedAt: String(parsed.updatedAt || '').trim(),
        statusText: String(parsed.statusText || humanizeUploadStatus(status)).trim(),
      };
    } catch (_error) {
      return null;
    }
  }

  function persistActiveUploadState(uploadState) {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      if (!uploadState) {
        window.localStorage.removeItem(getActiveUploadStorageKey());
        return;
      }
      window.localStorage.setItem(
        getActiveUploadStorageKey(),
        JSON.stringify({
          handoffId: uploadState.handoffId || '',
          intakeSessionId: uploadState.intakeSessionId || '',
          submissionId: uploadState.submissionId || '',
          status: normalizeUploadStatus(uploadState.status),
          progressPercent: coerceNonNegativeInteger(uploadState.progressPercent, 0),
          uploadedBytes: coerceNonNegativeInteger(uploadState.uploadedBytes, 0),
          totalBytes: coerceNonNegativeInteger(uploadState.totalBytes, 0),
          uploadedFiles: coerceNonNegativeInteger(uploadState.uploadedFiles, 0),
          totalFiles: coerceNonNegativeInteger(uploadState.totalFiles, 0),
          manifestVersion: coerceNonNegativeInteger(uploadState.manifestVersion, null),
          error: String(uploadState.error || '').trim(),
          updatedAt: String(uploadState.updatedAt || new Date().toISOString()).trim(),
          statusText: String(uploadState.statusText || humanizeUploadStatus(uploadState.status)).trim(),
        })
      );
    } catch (_error) {
      // Persistence must never block submission flow.
    }
  }

  function clearActiveUploadState() {
    state.activeUpload = null;
    state.uploadProgress = 0;
    state.uploadStatus = '';
    state.uploadUploadedBytes = 0;
    state.uploadTotalBytes = 0;
    state.uploadUploadedFiles = 0;
    state.uploadTotalFiles = 0;
    state.uploadError = '';
    state.uploadUpdatedAt = '';
    state.uploadControlInFlight = '';
    persistActiveUploadState(null);
  }

  function applyUploadState(uploadState, options) {
    var snapshot = uploadState && typeof uploadState === 'object' ? uploadState : null;
    var persist = !options || options.persist !== false;
    var shouldRender = !options || options.render !== false;
    if (!snapshot) {
      clearActiveUploadState();
      if (shouldRender) {
        renderMainPanel();
      }
      return;
    }

    state.activeUpload = {
      handoffId: String(snapshot.handoffId || '').trim(),
      intakeSessionId: String(snapshot.intakeSessionId || '').trim(),
      submissionId: String(snapshot.submissionId || '').trim(),
      manifestVersion: coerceNonNegativeInteger(snapshot.manifestVersion, null),
      status: normalizeUploadStatus(snapshot.status),
      progressPercent: coerceNonNegativeInteger(snapshot.progressPercent, 0),
      uploadedBytes: coerceNonNegativeInteger(snapshot.uploadedBytes, 0),
      totalBytes: coerceNonNegativeInteger(snapshot.totalBytes, 0),
      uploadedFiles: coerceNonNegativeInteger(snapshot.uploadedFiles, 0),
      totalFiles: coerceNonNegativeInteger(snapshot.totalFiles, 0),
      error: String(snapshot.error || '').trim(),
      updatedAt: String(snapshot.updatedAt || '').trim(),
      statusText: String(snapshot.statusText || humanizeUploadStatus(snapshot.status)).trim(),
    };
    state.uploadProgress = state.activeUpload.progressPercent;
    state.uploadStatus = state.activeUpload.statusText;
    state.uploadUploadedBytes = state.activeUpload.uploadedBytes;
    state.uploadTotalBytes = state.activeUpload.totalBytes;
    state.uploadUploadedFiles = state.activeUpload.uploadedFiles;
    state.uploadTotalFiles = state.activeUpload.totalFiles;
    state.uploadError = state.activeUpload.error;
    state.uploadUpdatedAt = state.activeUpload.updatedAt;
    if (persist) {
      persistActiveUploadState(state.activeUpload);
    }
    if (state.activeUpload && state.activeUpload.submissionId) {
      persistDraftContext(state.activeUpload.submissionId);
    }
    if (shouldRender) {
      renderMainPanel();
    }
  }

  function snapshotUploadStateFromSubmission(submission) {
    if (!submission) {
      return null;
    }
    var isCurrentStateUploading = String(submission.currentState || '').trim().toLowerCase() === 'uploading';
    var status = normalizeUploadStatus(submission.uploadStatus);
    if (!status && isCurrentStateUploading) {
      status = 'in_progress';
    }
    if (isCurrentStateUploading && (status === 'completed' || status === 'canceled')) {
      // Backend state is still "uploading", so keep submit UI in upload mode.
      status = 'in_progress';
    }
    if (!status) {
      return null;
    }
    return {
      handoffId: String(
        submission.uploadHandoffId ||
          (submission.uploadIntakeSessionId && Number.isInteger(submission.uploadManifestVersion)
            ? 'handoff:' + submission.uploadIntakeSessionId + ':' + submission.uploadManifestVersion
            : '')
      ).trim(),
      intakeSessionId: String(submission.uploadIntakeSessionId || '').trim(),
      submissionId: String(submission.submissionId || '').trim(),
      status: status,
      progressPercent: coerceNonNegativeInteger(submission.uploadProgressPercent, 0),
      uploadedBytes: coerceNonNegativeInteger(submission.uploadUploadedBytes, 0),
      totalBytes: coerceNonNegativeInteger(submission.uploadTotalBytes, 0),
      uploadedFiles: coerceNonNegativeInteger(submission.uploadUploadedFiles, 0),
      totalFiles: coerceNonNegativeInteger(submission.uploadTotalFiles, 0),
      manifestVersion: coerceNonNegativeInteger(submission.uploadManifestVersion, 0),
      error: String(submission.uploadError || '').trim(),
      updatedAt: String(submission.uploadUpdatedAt || '').trim(),
      statusText: humanizeUploadStatus(status),
    };
  }

  function getStoredOrSubmissionUploadState(submission) {
    var stored = readStoredActiveUploadState();
    var fromSubmission = snapshotUploadStateFromSubmission(submission);
    if (fromSubmission && !shouldSurfaceUploadStatus(fromSubmission.status)) {
      fromSubmission = null;
    }
    if (stored && !shouldSurfaceUploadStatus(stored.status)) {
      stored = null;
    }
    if (stored && submission && stored.submissionId === submission.submissionId) {
      if (fromSubmission) {
        if (isPausedUploadStatus(fromSubmission.status) || isTerminalUploadStatus(fromSubmission.status)) {
          return fromSubmission;
        }
        var storedUpdatedAt = Date.parse(String(stored.updatedAt || ''));
        var submissionUpdatedAt = Date.parse(String(fromSubmission.updatedAt || ''));
        if (Number.isFinite(submissionUpdatedAt) && Number.isFinite(storedUpdatedAt) && submissionUpdatedAt >= storedUpdatedAt) {
          return fromSubmission;
        }
      }
      return stored;
    }
    return fromSubmission;
  }

  function isSubmissionUploading(submission) {
    return String(submission && submission.currentState ? submission.currentState : '').trim().toLowerCase() === 'uploading';
  }

  function stopUploadStatusPolling() {
    if (state.uploadPollTimer) {
      clearInterval(state.uploadPollTimer);
      state.uploadPollTimer = null;
    }
  }

  async function pollUploadStatusOnce() {
    var bridge = ipc();
    if (!bridge || !bridge.intake || typeof bridge.intake.getHandoffStatus !== 'function') {
      return;
    }
    if (!state.activeUpload || !state.activeUpload.handoffId) {
      return;
    }

    try {
      var response = await bridge.intake.getHandoffStatus({ handoffId: state.activeUpload.handoffId });
      if (!response || !response.ok || !response.data || !response.data.handoff) {
        return;
      }
      var handoff = response.data.handoff;
      applyUploadState({
        handoffId: handoff.handoffId,
        intakeSessionId: handoff.intakeSessionId,
        submissionId: handoff.submissionId,
        status: handoff.status,
        progressPercent: handoff.progressPercent,
        uploadedBytes: handoff.uploadedBytes,
        totalBytes: handoff.totalBytes,
        uploadedFiles: handoff.uploadedFiles,
        totalFiles: handoff.totalFiles,
        error: handoff.error,
        updatedAt: handoff.updatedAt,
        statusText: humanizeUploadStatus(handoff.status),
      }, { persist: true });

      if (isTerminalUploadStatus(handoff.status)) {
        stopUploadStatusPolling();
        state.isSubmitting = false;
        if (handoff.status === 'completed') {
          showFeedback('success', 'Uploaded to Dropbox. Submission moved to under review.');
        } else if (handoff.status === 'failed') {
          showFeedback('error', handoff.error || 'Dropbox upload failed. Your submission returned to draft.');
        } else {
          showFeedback('warning', 'Upload canceled. Your submission returned to draft.');
        }
        await loadSubmissions();
        var refreshedSubmission = handoff.submissionId ? getSubmissionById(handoff.submissionId) : null;
        var refreshedState = String(refreshedSubmission && refreshedSubmission.currentState || '').trim().toLowerCase();
        if (handoff.submissionId) {
          if (handoff.status === 'completed' && refreshedState === 'under_review') {
            clearActiveUploadState();
            state.mode = 'detail';
            state.selectedSubmissionId = handoff.submissionId;
            await loadTimeline(handoff.submissionId);
          } else if (handoff.status === 'completed') {
            state.mode = 'draft';
            state.uiViewStep = 'review';
            state.selectedSubmissionId = handoff.submissionId;
            state.isSubmitting = true;
            state.uploadControlInFlight = '';
            renderMainPanel();
          } else if (handoff.status === 'canceled') {
            state.mode = 'draft';
            state.selectedSubmissionId = handoff.submissionId;
            state.uiViewStep = 'review';
            state.selectedTimeline = [];
            state.isSubmitting = false;
            state.uploadControlInFlight = '';
            renderMainPanel();
          } else if (handoff.status === 'failed') {
            state.mode = 'draft';
            state.selectedSubmissionId = handoff.submissionId;
            state.uiViewStep = 'review';
            state.selectedTimeline = [];
            state.isSubmitting = false;
            state.uploadControlInFlight = '';
            renderMainPanel();
          } else {
            clearActiveUploadState();
            state.mode = 'draft';
            state.selectedSubmissionId = handoff.submissionId;
            state.uiViewStep = 'review';
            state.selectedTimeline = [];
            renderMainPanel();
          }
        }
      } else if (isPausedUploadStatus(handoff.status)) {
        stopUploadStatusPolling();
        state.isSubmitting = false;
        showFeedback('warning', 'Upload paused. Resume or cancel when ready.');
      }
    } catch (_error) {
      // Polling should be resilient; the next tick will retry.
    }
  }

  function startUploadStatusPolling() {
    stopUploadStatusPolling();
    state.uploadPollTimer = setInterval(function () {
      void pollUploadStatusOnce();
    }, 2500);
    void pollUploadStatusOnce();
  }

  async function handleUploadControlAction(action) {
    var normalizedAction = String(action || '').trim().toLowerCase();
    var bridge = ipc();
    if (!normalizedAction || !state.activeUpload || !state.activeUpload.handoffId) {
      return;
    }
    if (!bridge || !bridge.intake || typeof bridge.intake.controlHandoff !== 'function') {
      showFeedback('error', 'Upload control IPC channel is unavailable.');
      return;
    }
    if (state.uploadControlInFlight) {
      return;
    }

    state.uploadControlInFlight = normalizedAction;
    renderMainPanel();

    try {
      var response = await bridge.intake.controlHandoff({
        handoffId: state.activeUpload.handoffId,
        action: normalizedAction,
        requestId: 'intake-handoff-control-' + Date.now(),
        actorId: getActorId(),
        actorRole: getActorRole(),
      });
      if (!response || !response.ok || !response.data || !response.data.handoff) {
        throw new Error(
          response && response.error && response.error.message
            ? response.error.message
            : 'Failed to update upload state.'
        );
      }

      var handoff = response.data.handoff;
      applyUploadState({
        handoffId: handoff.handoffId,
        intakeSessionId: handoff.intakeSessionId,
        submissionId: handoff.submissionId,
        status: handoff.status,
        progressPercent: handoff.progressPercent,
        uploadedBytes: handoff.uploadedBytes,
        totalBytes: handoff.totalBytes,
        uploadedFiles: handoff.uploadedFiles,
        totalFiles: handoff.totalFiles,
        error: handoff.error,
        updatedAt: handoff.updatedAt,
        statusText: humanizeUploadStatus(handoff.status),
      }, { persist: true, render: false });

      if (handoff.status === 'paused') {
        state.isSubmitting = false;
        stopUploadStatusPolling();
        showFeedback('warning', 'Upload paused. You can resume or cancel it later.');
      } else if (handoff.status === 'canceled') {
        state.isSubmitting = false;
        stopUploadStatusPolling();
        clearActiveUploadState();
        showFeedback('warning', 'Upload canceled. Click Submit for Review to start a new upload attempt.');
      } else if (handoff.status === 'queued' || handoff.status === 'in_progress') {
        state.isSubmitting = true;
        startUploadStatusPolling();
        showFeedback('success', normalizedAction === 'resume' ? 'Upload resumed.' : 'Upload updated.');
      } else {
        await pollUploadStatusOnce();
      }

      await loadSubmissions();
    } catch (error) {
      showFeedback('error', toCreatorSafeSurfaceMessage('submit', error && error.message));
    } finally {
      state.uploadControlInFlight = '';
      renderMainPanel();
    }
  }

  function inferCategoryFromPath(relativePath) {
    var normalized = String(relativePath || '').toLowerCase();
    if (normalized.endsWith('.zip')) { return 'audio_zip'; }
    if (normalized.endsWith('.wav') || normalized.endsWith('.mp3') || normalized.endsWith('.aiff')) {
      return 'audio';
    }
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg') || normalized.endsWith('.png')) {
      return 'artwork';
    }
    if (normalized.endsWith('.mid') || normalized.endsWith('.midi')) { return 'midi'; }
    return 'other';
  }

  function isRequiredAsset(relativePath) {
    var root = String(relativePath || '').split('/')[0];
    if (packStructure && typeof packStructure.isKnownTopLevelFolder === 'function') {
      return packStructure.isKnownTopLevelFolder(root);
    }
    return false;
  }

  async function buildManifestFilesFromSelection(selectedFolder) {
    var folder = selectedFolder || state.selectedFolder;
    var entries = folder && Array.isArray(folder.files) ? folder.files : [];
    return Promise.all(entries.map(async function (entry) {
      var relativePath = String(entry.relativePath || '').replace(/\\/g, '/');
      var sizeBytes = Math.max(1, Number(entry.sizeBytes || 1));
      var mimeType = entry.mimeType || 'application/octet-stream';
      var category = inferCategoryFromPath(relativePath);
      var requiredAsset = isRequiredAsset(relativePath);
      return {
        relativePath: relativePath,
        sizeBytes: sizeBytes,
        sha256: await digestSha256Hex(buildManifestFileHashSource({
          relativePath: relativePath,
          sizeBytes: sizeBytes,
          mimeType: mimeType,
          category: category,
          requiredAsset: requiredAsset,
        })),
        mimeType: mimeType,
        category: category,
        requiredAsset: requiredAsset,
      };
    }));
  }

  async function buildManifestFilesAndChecksum(selectedFolder) {
    var files = await buildManifestFilesFromSelection(selectedFolder);
    return {
      files: files,
      manifestChecksum: await buildManifestChecksum(files),
    };
  }

  async function handleSelectPackFolder() {
    var bridge = ipc();
    if (!bridge || !bridge.intake || !bridge.intake.selectFolder) {
      showFeedback('warning', 'Folder picker IPC is unavailable.');
      return;
    }

    syncDraftStateFromForm();
    var result = await bridge.intake.selectFolder();
    if (!result.ok || !result.data || !result.data.path) {
      return;
    }

    var topLevelFolders = Array.isArray(result.data.topLevelFolders) ? result.data.topLevelFolders : [];
    var missing = resolveMissingRequiredFolders(topLevelFolders);
    var previousPath = state.selectedFolder && state.selectedFolder.path ? String(state.selectedFolder.path) : '';
    var selectedPath = String(result.data.path || '');
    var folderChanged = previousPath !== selectedPath;

    state.selectedFolder = {
      path: result.data.path,
      fileCount: result.data.fileCount || 0,
      topLevelFolders: topLevelFolders,
      files: Array.isArray(result.data.files) ? result.data.files : [],
    };
    state.missingTopLevelFolders = missing;
    if (state.draft.submissionId && folderChanged) {
      state.qcPassed[state.draft.submissionId] = false;
      state.qcResults[state.draft.submissionId] = {
        status: 'stale',
        findings: [],
      };
    }
    if (state.draft.submissionId) {
      persistDraftContext(state.draft.submissionId);
    }
    scheduleFocusTarget(missing.length > 0 ? 'workspace-select-pack-folder' : 'workspace-run-qc');
    renderMainPanel();

    if (missing.length > 0) {
      showFeedback('warning', buildStructureGateMessage(missing) + ' ' + buildMissingRequiredFolderGuidance(missing));
      return;
    }
    showFeedback('success', 'Pack folder selected. Run QC now to refresh remediation and submit readiness.');
  }

  async function loadCreatorProfile() {
    var bridge = ipc();
    if (!bridge || !bridge.creator || !bridge.creator.profile) {
      return { ok: false, kind: 'bridge_unavailable' };
    }

    var actorId = getActorId();
    var response;
    try {
      response = await bridge.creator.profile.get({ actorId: actorId, userId: 'me' });
    } catch (error) {
      return {
        ok: false,
        kind: isBackendUnavailableError({ message: error && error.message }) ? 'backend_unreachable' : 'error',
        error: error,
      };
    }
    if (response && response.ok) {
      state.profile = response.data;
      if (!state.draft.labelName && response.data && response.data.labelName) {
        state.draft.labelName = response.data.labelName;
      }
      return { ok: true };
    }
    return {
      ok: false,
      kind: isBackendUnavailableError(response && response.error) ? 'backend_unreachable' : 'error',
      error: response ? response.error : null,
    };
  }

  async function loadSubmissions() {
    var bridge = ipc();
    if (state.isLoadingSubmissions) {
      return { ok: false, kind: 'loading', empty: state.submissions.length === 0 };
    }
    state.isLoadingSubmissions = true;
    try {
      if (!bridge || !bridge.submissions || !bridge.submissions.list) {
        state.submissions = [];
        state.timelinesBySubmissionId = {};
        render();
        return { ok: false, kind: 'bridge_unavailable', empty: true };
      }

      var actorId = getActorId();
      var response;
      try {
        response = await bridge.submissions.list({ creatorId: actorId });
      } catch (_error) {
        if (state.submissions.length > 0) {
          showFeedback('warning', 'Showing last loaded submission history. Backend unreachable; retry after API recovery.');
        } else {
          showFeedback('error', 'Backend unreachable. Submission history cannot load right now. Start API service, then retry.');
        }
        return { ok: false, kind: 'backend_unreachable', empty: state.submissions.length === 0 };
      }
      if (!response.ok) {
        if (isBackendUnavailableError(response.error)) {
          if (state.submissions.length > 0) {
            showFeedback('warning', 'Showing last loaded submission history. Backend unreachable; retry after API recovery.');
          } else {
            showFeedback('error', 'Backend unreachable. Submission history cannot load right now. Start API service, then retry.');
          }
          return { ok: false, kind: 'backend_unreachable', empty: state.submissions.length === 0 };
        } else {
          if (state.submissions.length > 0) {
            showFeedback('warning', 'Showing last loaded submission history. Latest refresh failed; retry to sync.');
          } else {
            showFeedback('error', response.error ? response.error.message : 'Failed to load submissions.');
          }
          return { ok: false, kind: 'error', empty: state.submissions.length === 0 };
        }
      }

      state.submissions = Array.isArray(response.data && response.data.submissions) ? response.data.submissions : [];

      var activeUploadSubmission = null;
      var persistedUploadState = readStoredActiveUploadState();
      if (state.activeUpload && state.activeUpload.submissionId) {
        activeUploadSubmission = getSubmissionById(state.activeUpload.submissionId);
      }
      if (!activeUploadSubmission && persistedUploadState && persistedUploadState.submissionId) {
        activeUploadSubmission = getSubmissionById(persistedUploadState.submissionId);
      }
      if (!activeUploadSubmission && state.selectedSubmissionId) {
        activeUploadSubmission = getSubmissionById(state.selectedSubmissionId);
      }
      if (activeUploadSubmission && String(activeUploadSubmission.currentState || '').trim().toLowerCase() === 'uploading') {
        var refreshedUploadState = getStoredOrSubmissionUploadState(activeUploadSubmission);
        if (refreshedUploadState) {
          applyUploadState(refreshedUploadState, {
            persist: Boolean(refreshedUploadState.handoffId),
            render: false,
          });
          state.selectedSubmissionId = activeUploadSubmission.submissionId;
          state.mode = 'draft';
          state.uiViewStep = 'review';
          state.isSubmitting = isActiveUploadStatus(refreshedUploadState.status);
          if (refreshedUploadState.handoffId && isActiveUploadStatus(refreshedUploadState.status)) {
            startUploadStatusPolling();
          }
        }
      }

      state.timelinesBySubmissionId = {};
      if (typeof bridge.submissions.timeline === 'function') {
        await Promise.all(state.submissions.map(async function (submission) {
          try {
            var timelineResponse = await bridge.submissions.timeline({
              submissionId: submission.submissionId,
              creatorId: actorId,
            });
            state.timelinesBySubmissionId[submission.submissionId] = timelineResponse && timelineResponse.ok && timelineResponse.data
              ? (timelineResponse.data.timeline || [])
              : [];
          } catch (_timelineError) {
            state.timelinesBySubmissionId[submission.submissionId] = [];
          }
        }));
      }

      if (!state.selectedSubmissionId && state.submissions.length > 0 && state.mode !== 'draft') {
        // Show the history list view first — user explicitly clicks a submission to open it.
        state.mode = 'list';
      }

      render();

      if (state.pendingShortcut) {
        var deferredShortcut = state.pendingShortcut;
        state.pendingShortcut = '';
        applySubmissionsShortcut(deferredShortcut);
      }
      return { ok: true, kind: state.submissions.length === 0 ? 'no_data' : 'loaded', empty: state.submissions.length === 0 };
    } finally {
      state.isLoadingSubmissions = false;
    }
  }

  async function loadTimeline(submissionId) {
    var bridge = ipc();
    if (!bridge || !bridge.submissions || !bridge.submissions.timeline) {
      state.selectedTimeline = [];
      renderMainPanel();
      return;
    }

    var actorId = getActorId();
    var response = await bridge.submissions.timeline({
      submissionId: submissionId,
      creatorId: actorId,
    });

    if (!response.ok) {
      if (!state.selectedTimeline.length) {
        state.selectedTimeline = [];
      }
      if (isBackendUnavailableError(response.error)) {
        if (state.selectedTimeline.length > 0) {
          showFeedback('warning', 'Showing last loaded timeline. Backend unreachable; retry when API service is back.');
        } else {
          showFeedback('warning', 'Timeline unavailable because backend is unreachable. Start API service, then retry.');
        }
      } else {
        if (state.selectedTimeline.length > 0) {
          showFeedback('warning', 'Showing last loaded timeline. Latest timeline refresh failed; retry to sync.');
        } else {
          showFeedback('warning', 'Timeline unavailable for this submission. Retry to refresh.');
        }
      }
      renderMainPanel();
      focusElementById('workspace-lifecycle-banner');
      return;
    }

    state.selectedTimeline = response.data.timeline || [];
    state.timelinesBySubmissionId[submissionId] = state.selectedTimeline.slice();
    renderMainPanel();
    focusElementById('workspace-lifecycle-banner');
  }

  function draftToPayload(draft) {
    return {
      submissionId: draft.submissionId,
      creatorId: getActorId(),
      packName: draft.packName,
      labelName: draft.labelName,
      releaseMonth: draft.releaseMonth || null,
      notes: draft.notes || null,
      tags: draft.tags || [],
      airtableFormCompleted: Boolean(state.airtable && state.airtable.formCompleted),
      airtablePayloadChecksum: state.airtable && state.airtable.payloadChecksum
        ? state.airtable.payloadChecksum
        : null,
      autosaveJson: {
        packName: draft.packName,
        labelName: draft.labelName,
        releaseMonth: draft.releaseMonth,
        notes: draft.notes,
        tags: draft.tags,
      },
    };
  }

  async function createDraftIfNeeded(draft) {
    var bridge = ipc();
    if (!bridge || !bridge.submissions || !bridge.submissions.createDraft) {
      throw new Error('Submission draft IPC not available.');
    }

    if (draft.submissionId) {
      return draft.submissionId;
    }

    var submissionId = 'creator-draft-' + Date.now();
    var createPayload = draftToPayload({
      submissionId: submissionId,
      packName: draft.packName,
      labelName: draft.labelName,
      releaseMonth: draft.releaseMonth,
      notes: draft.notes,
      tags: draft.tags,
    });

    var createResponse = await bridge.submissions.createDraft(createPayload);
    if (!createResponse.ok) {
      var createErr = createResponse.error ? createResponse.error.message : 'Failed to create draft.';
      throw new Error(createErr);
    }

    state.draft.submissionId = submissionId;
    return submissionId;
  }

  async function saveMetadata(manual) {
    var bridge = ipc();
    if (!bridge || !bridge.submissions || !bridge.submissions.updateMetadata) {
      return;
    }

    var draft = syncDraftStateFromForm();

    if (!isMetadataComplete(draft)) {
      if (manual) {
        showFeedback('warning', 'Complete Pack Name, Label Name, and Release Month first.');
        if (!draft.packName) {
          scheduleFocusTarget('workspace-pack-name');
        } else if (!draft.labelName) {
          scheduleFocusTarget('workspace-label-name');
        } else {
          scheduleFocusTarget('workspace-release-month');
        }
      }
      return;
    }

    try {
      var submissionId = await createDraftIfNeeded(draft);
      var response = await bridge.submissions.updateMetadata(
        draftToPayload({
          submissionId: submissionId,
          packName: draft.packName,
          labelName: draft.labelName,
          releaseMonth: draft.releaseMonth,
          notes: draft.notes,
          tags: draft.tags,
        })
      );

      if (!response.ok) {
        var err = response.error ? response.error.message : 'Metadata save failed.';
        throw new Error(err);
      }

      state.selectedSubmissionId = submissionId;
      if (manual) {
        showFeedback('success', 'Metadata saved.');
        scheduleFocusTarget('workspace-airtable-complete');
      }
      await loadSubmissions();
    } catch (error) {
      showFeedback('error', toCreatorSafeSurfaceMessage('metadata', error && error.message));
    }
  }

  async function runQcCheck() {
    var bridge = ipc();
    if (!bridge || !bridge.qc || !bridge.qc.evaluatePack) {
      showFeedback('warning', 'QC IPC is unavailable.');
      return;
    }
    if (state.isQcRunning) {
      return;
    }

    var draft = syncDraftStateFromForm();
    var validationError = validateDraft(draft);
    if (validationError) {
      showFeedback('warning', validationError);
      return;
    }

    try {
      state.isQcRunning = true;
      state.qcRunStatus = {
        tone: 'running',
        message: 'QC running... Please wait.',
      };
      renderMainPanel();

      var submissionId = await createDraftIfNeeded(draft);
      state.selectedSubmissionId = submissionId;
      var selectedFiles = state.selectedFolder && Array.isArray(state.selectedFolder.files)
        ? state.selectedFolder.files
        : [];
      var declaredTopLevelFolders =
        state.selectedFolder && Array.isArray(state.selectedFolder.topLevelFolders)
          ? state.selectedFolder.topLevelFolders.filter(function (entry) {
              return typeof entry === 'string' && entry.trim().length > 0;
            })
          : [];
      if (declaredTopLevelFolders.length === 0) {
        declaredTopLevelFolders = ['Artwork', 'Audio', 'Demo', 'Description'];
      }
      var resolvedSampleCount = state.selectedFolder && Number.isFinite(Number(state.selectedFolder.fileCount))
        ? Math.max(0, Number(state.selectedFolder.fileCount))
        : selectedFiles.length;
      var audioZipEntry = selectedFiles.find(function (entry) {
        return typeof entry.relativePath === 'string' && /(^|\/)audio\/.+\.zip$/i.test(entry.relativePath);
      });

      var response = await bridge.qc.evaluatePack({
        requestId: 'qc-' + Date.now(),
        submissionId: submissionId,
        actorId: getActorId(),
        actorRole: getActorRole(),
        pack: {
          packName: draft.packName,
          localPackPath: state.selectedFolder && state.selectedFolder.path ? state.selectedFolder.path : null,
          declaredTopLevelFolders: declaredTopLevelFolders,
          audioZip: audioZipEntry
            ? {
                filename: String(audioZipEntry.relativePath).split('/').pop(),
                sizeBytes: Math.max(0, Number(audioZipEntry.sizeBytes || 0)),
              }
            : null,
          sampleCount: resolvedSampleCount,
          containsUnsupportedNameTokens: false,
        },
      });

      if (!response.ok) {
        var err = response.error ? response.error.message : 'QC check failed.';
        throw new Error(err);
      }

      var passed = response.data && response.data.report && response.data.report.status === 'passed';
      var report = response.data && response.data.report ? response.data.report : { findings: [], status: passed ? 'passed' : 'failed' };
      state.qcPassed[submissionId] = passed;
      state.qcResults[submissionId] = {
        status: report.status || (passed ? 'passed' : 'failed'),
        findings: Array.isArray(report.findings) ? report.findings : [],
      };
      persistDraftContext(submissionId);
      var workflowContext = buildWorkflowContext(state.draft);
      if (passed) {
        scheduleFocusTarget(workflowContext.canSubmit ? 'workspace-submit-review' : 'workspace-airtable-complete');
      } else {
        scheduleFocusTarget('workspace-remediation-items');
      }
      renderMainPanel();

      if (passed) {
        showFeedback('success', 'QC passed. Submission is eligible for review.');
        state.qcRunStatus = {
          tone: 'success',
          message: 'QC finished: passed with no blocking findings.',
        };
      } else {
        showFeedback('warning', 'QC failed. Resolve findings before review submission.');
        state.qcRunStatus = {
          tone: 'warning',
          message: 'QC finished: blocking findings found. Resolve them and rerun QC.',
        };
      }
    } catch (error) {
      showFeedback('error', toCreatorSafeSurfaceMessage('qc', error && error.message));
      state.qcRunStatus = {
        tone: 'error',
        message: 'QC failed to run. Please try Run QC again.',
      };
    } finally {
      state.isQcRunning = false;
      renderMainPanel();
    }
  }

  async function handleCompleteAirtableStep() {
    var bridge = ipc();
    var draft = syncDraftStateFromForm();
    var validationError = validateDraft(draft);
    if (validationError) {
      showFeedback('warning', validationError);
      return;
    }
    try {
      var submissionId = await createDraftIfNeeded(draft);
      state.selectedSubmissionId = submissionId;
      state.draft.submissionId = submissionId;
      state.airtable.formCompleted = true;
      state.airtable.payloadChecksum = buildAirtableChecksum(draft);

      await saveMetadata(false);

      if (bridge && bridge.submissions && typeof bridge.submissions.syncAirtable === 'function') {
        var response = await bridge.submissions.syncAirtable({
          submissionId: submissionId,
          creatorId: getActorId(),
          forceRelink: false,
        });
        if (!response.ok) {
          throw new Error(response.error ? response.error.message : 'Airtable sync failed.');
        }
        state.airtable.formCompleted = Boolean(response.data.airtableFormCompleted);
        state.airtable.payloadChecksum = String(response.data.airtablePayloadChecksum || state.airtable.payloadChecksum || '');
        state.airtable.syncStatus = response.data.syncStatus || null;
        state.airtable.recordId = String(response.data.airtableRecordId || '');
        state.airtable.recordUrl = String(response.data.airtableRecordUrl || '');
        state.airtable.lastSyncedAt = String(response.data.lastSyncedAt || '');
        state.airtable.lastErrorCode = String(response.data.lastErrorCode || '');
        state.airtable.lastErrorDetail = String(response.data.lastErrorDetail || '');
        state.airtable.mappedPayload = response.data.mappedPayload || null;
      } else {
        state.airtable.syncStatus = state.airtable.syncStatus || 'linked';
      }

      scheduleFocusTarget('workspace-airtable-complete');
      renderMainPanel();
      
      if (state.airtable.syncStatus === 'linked') {
        showFeedback('success', 'Airtable details linked and validated for this draft.');
      } else {
        showFeedback('warning', 'Airtable details saved, but link status still needs attention before submit.');
      }
    } catch (error) {
      showFeedback('error', toCreatorSafeSurfaceMessage('metadata', error && error.message));
    }
  }

  async function handleResetAirtableStep() {
    var bridge = ipc();
    try {
      if (state.draft.submissionId && bridge && bridge.submissions && typeof bridge.submissions.resetAirtable === 'function') {
        var response = await bridge.submissions.resetAirtable({
          submissionId: state.draft.submissionId,
          creatorId: getActorId(),
        });
        if (!response.ok) {
          throw new Error(response.error ? response.error.message : 'Airtable reset failed.');
        }
      }
      state.airtable.formCompleted = false;
      state.airtable.payloadChecksum = '';
      state.airtable.syncStatus = null;
      state.airtable.recordId = '';
      state.airtable.recordUrl = '';
      state.airtable.lastSyncedAt = '';
      state.airtable.lastErrorCode = '';
      state.airtable.lastErrorDetail = '';
      state.airtable.mappedPayload = null;
      renderMainPanel();
      await saveMetadata(true);
      showFeedback('warning', 'Airtable completion reset. Submit is blocked until step 1 is complete.');
    } catch (error) {
      showFeedback('error', toCreatorSafeSurfaceMessage('metadata', error && error.message));
    }
  }

  async function handleSubmitForReview() {
    var bridge = ipc();
    if (!bridge || !bridge.intake || !bridge.submissions || !bridge.submissions.transition) {
      showFeedback('error', 'Submit IPC channels are unavailable.');
      return;
    }

    var draft = syncDraftStateFromForm();
    var validationError = validateDraft(draft);
    if (validationError) {
      showFeedback('warning', validationError);
      return;
    }

    var workflowContext = buildWorkflowContext(state.draft);
    var submissionId = state.draft.submissionId;
    if (!workflowContext.canSubmit) {
      var readiness = evaluateSubmitReadiness({
        draft: state.draft,
        selectedFolder: state.selectedFolder,
        missingTopLevelFolders: state.missingTopLevelFolders,
        qcPassed: submissionId ? state.qcPassed[submissionId] === true : false,
        isSubmitting: state.isSubmitting,
      });
      if (readiness.canSubmit) {
        var workflowBlockers = mapWorkflowBlockersToReadiness(workflowContext);
        if (workflowBlockers.length > 0) {
          readiness = {
            canSubmit: false,
            blockers: workflowBlockers,
          };
        }
      }
      showFeedback('warning', buildSubmitBlockedFeedbackMessage(readiness));
      scheduleFocusTarget(resolveDraftFocusTargetForReadiness(readiness, state.draft.packName, state.draft.labelName));
      renderMainPanel();
      return;
    }

    if (state.activeUpload && (isPausedUploadStatus(state.activeUpload.status) || isTerminalUploadStatus(state.activeUpload.status))) {
      var currentUploadStatus = normalizeUploadStatus(state.activeUpload.status);
      if (currentUploadStatus === 'paused') {
        showFeedback('warning', 'Upload is paused. Use Resume Upload to continue or Cancel Upload to abort.');
        renderMainPanel();
        return;
      } else if (currentUploadStatus === 'failed') {
        showFeedback('warning', 'Upload previously failed. Use Resume Upload to retry explicitly.');
        renderMainPanel();
        return;
      } else if (currentUploadStatus === 'canceled' || currentUploadStatus === 'completed') {
        clearActiveUploadState();
      }
    }

    if (state.isSubmitting || (state.activeUpload && isActiveUploadStatus(state.activeUpload.status))) {
      return;
    }

    state.isSubmitting = true;
    setUploadProgress(5, 'Saving metadata');
    var uploadStarted = false;

    try {
      await saveMetadata(true);

      var manifestPayload = await buildManifestFilesAndChecksum(state.selectedFolder);
      var manifestFiles = manifestPayload.files;
      if (!manifestFiles.length) {
        throw new Error('Selected folder has no files to upload.');
      }

      setUploadProgress(20, 'Starting intake session');
      var startResponse = await bridge.intake.startSession({
        requestId: 'intake-start-' + Date.now(),
        submissionId: submissionId,
        creatorId: getActorId(),
        packName: draft.packName,
        declaredTopLevelFolders: state.selectedFolder.topLevelFolders || [],
        metadata: {
          local_pack_path: state.selectedFolder.path,
          creator_id: getActorId(),
          pack_name: draft.packName,
          declared_top_level_folders: state.selectedFolder.topLevelFolders || [],
          manifest_checksum: manifestPayload.manifestChecksum,
        },
      });
      if (!startResponse.ok) {
        throw new Error(startResponse.error ? startResponse.error.message : 'Failed to start intake session.');
      }

      var sessionStatus = String(startResponse.data.session.status || '').toLowerCase() || 'initiated';
      var intakeSessionId = startResponse.data.session.intakeSessionId;
      
      if (sessionStatus === 'initiated' || sessionStatus === 'manifest_failed') {
        setUploadProgress(40, 'Uploading manifest');
        var manifestResponse = await bridge.intake.putManifest({
          intakeSessionId: intakeSessionId,
          requestId: 'intake-manifest-' + Date.now(),
          files: manifestFiles,
          lockManifest: true,
        });
        if (!manifestResponse.ok) {
          throw new Error(manifestResponse.error ? manifestResponse.error.message : 'Failed to upload manifest.');
        }
      }

      if (sessionStatus !== 'transfer_completed') {
        setUploadProgress(65, 'Uploading files to Dropbox');
        var handoffResponse = await bridge.intake.createHandoff({
          intakeSessionId: intakeSessionId,
          requestId: 'intake-handoff-' + Date.now(),
          actorId: getActorId(),
          actorRole: getActorRole(),
        });
        if (!handoffResponse.ok) {
          throw new Error(handoffResponse.error ? handoffResponse.error.message : 'Failed to create Dropbox handoff.');
        }

        applyUploadState({
          handoffId: handoffResponse.data.handoff.handoffId,
          intakeSessionId: handoffResponse.data.handoff.intakeSessionId,
          submissionId: handoffResponse.data.handoff.submissionId,
          status: handoffResponse.data.handoff.status,
          progressPercent: handoffResponse.data.handoff.progressPercent,
          uploadedBytes: handoffResponse.data.handoff.uploadedBytes,
          totalBytes: handoffResponse.data.handoff.totalBytes,
          uploadedFiles: handoffResponse.data.handoff.uploadedFiles,
          totalFiles: handoffResponse.data.handoff.totalFiles,
          error: handoffResponse.data.handoff.error,
          updatedAt: handoffResponse.data.handoff.updatedAt,
          statusText: humanizeUploadStatus(handoffResponse.data.handoff.status),
        });

        uploadStarted = true;
        startUploadStatusPolling();
      }

      setUploadProgress(82, 'Locking files');
      var lockResponse = await bridge.intake.lockSubmissionFiles({
        submissionId: submissionId,
        intakeSessionId: intakeSessionId,
        actorId: getActorId(),
        actorRole: getActorRole(),
      });
      if (!lockResponse.ok) {
        throw new Error(lockResponse.error ? lockResponse.error.message : 'Failed to lock submission files.');
      }

      setUploadProgress(92, 'Marking submission as uploading');
      var expectedVersion = resolveSubmissionExpectedVersion(submissionId);
      var transitionResponse = await bridge.submissions.transition({
        submissionId: submissionId,
        requestId: 'submit-uploading-' + Date.now(),
        toState: 'uploading',
        actorId: getActorId(),
        actorRole: getActorRole(),
        expectedVersion: expectedVersion,
        metadata: {
          intakeSessionId: intakeSessionId,
          intake_session_id: intakeSessionId,
          pack_name: draft.packName || null,
          label_name: draft.labelName || null,
          preferred_release_month: draft.releaseMonth || null,
        },
      });
      if (!transitionResponse.ok) {
        throw new Error(
          transitionResponse.error ? transitionResponse.error.message : 'Failed to transition submission.'
        );
      }

      state.selectedFolder = Object.assign({}, state.selectedFolder, {
        manifestChecksum: manifestPayload.manifestChecksum,
      });
      state.mode = 'draft';
      state.uiViewStep = 'review';
      scheduleFocusTarget('workspace-submit-review');
      showFeedback('success', 'Upload started in the background. Progress will update here while the submission uploads.');
      await loadSubmissions();
      await pollUploadStatusOnce();
    } catch (error) {
      showFeedback('error', toCreatorSafeSurfaceMessage('submit', error && error.message));
      setUploadProgress(0, '');
      stopUploadStatusPolling();
      clearActiveUploadState();
      uploadStarted = false;
    } finally {
      if (!uploadStarted) {
        state.isSubmitting = false;
      }
      scheduleFocusTarget('workspace-submit-review');
      renderMainPanel();
    }
  }

  function renderSidebar() {
    var target = document.getElementById('workspace-submission-list');
    if (!target) { return; }
    target.innerHTML = historyPanel.renderSidebarList({
      submissions: state.submissions,
      timelinesBySubmissionId: state.timelinesBySubmissionId,
      escapeHtml: escapeHtml
    });
  }

  /* ── Wizard Step Helpers ─────────────────────────────────── */

  var WIZARD_STEPS = ['airtable', 'intake', 'review'];
  var WIZARD_STEP_LABELS = {
    airtable: 'Airtable Details',
    intake: 'Pack Intake & QC',
    review: 'Review & Submit',
  };

  function resolveStepStatus(stepId, workflowContext, activeStep) {
    var order = WIZARD_STEPS.indexOf(stepId);
    var activeOrder = WIZARD_STEPS.indexOf(activeStep);
    if (stepId === 'airtable') {
      return workflowContext.stepAirtableComplete ? 'done' : (order <= activeOrder ? 'active' : 'pending');
    }
    if (stepId === 'intake') {
      // Combined step is done when both folder/structure and QC are complete
      return (workflowContext.stepIntakeComplete && workflowContext.stepQcComplete) ? 'done' : (order <= activeOrder ? 'active' : 'pending');
    }
    if (stepId === 'review') {
      return workflowContext.canSubmit ? 'done' : 'pending';
    }
    return 'pending';
  }

  function renderDraftEditor() {
    var submissionId = state.draft.submissionId;
    var draft = state.draft;
    var restoredSubmission = getSubmissionById(submissionId);
    var draftLifecycle = restoredSubmission
      ? resolveLifecycleVisibility(restoredSubmission, state.selectedTimeline || [])
      : null;
    var hasFolder = Boolean(state.selectedFolder && state.selectedFolder.path);
    var missingFolders = state.missingTopLevelFolders || [];
    var workflowContext = buildWorkflowContext(draft);
    var canSubmit = workflowContext.canSubmit;
    var activeStep = workflowContext.activeStep;
    var qcPassed = submissionId ? state.qcPassed[submissionId] === true : false;
    // Use canonical readiness that includes Airtable gate so the readiness panel
    // summary and blockers are always consistent with the submit button state.
    var readiness = buildCanonicalReadiness({
      draft: draft,
      selectedFolder: state.selectedFolder,
      missingTopLevelFolders: missingFolders,
      qcPassed: qcPassed,
      isSubmitting: state.isSubmitting,
      workflowContext: workflowContext,
    });
    var qcResult = submissionId ? state.qcResults[submissionId] : null;
    var qcStatusMarkup = buildQcRunStatusMarkup(state.qcRunStatus);
    var readinessSummary = buildReadinessSummaryText(readiness);
    var checklist = resolveTopLevelFolderChecklist(hasFolder ? state.selectedFolder.topLevelFolders : []);
    var activeUpload = state.activeUpload && String(state.activeUpload.submissionId || '') === String(submissionId || '')
      ? state.activeUpload
      : null;
    var checklistMarkup = (hasFolder && checklist.length)
      ? (
          '<div id="workspace-folder-checklist" class="flex flex-wrap gap-1.5 mt-2">' +
          checklist.map(function (item) {
            return (
              '<span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ' +
              (item.present
                ? 'border-green-600 text-green-700 bg-green-50'
                : 'border-brand-danger text-brand-danger bg-red-50') +
              '">' +
              (item.present ? '✓ ' : '× ') +
              escapeHtml(item.label) +
              '</span>'
            );
          }).join('') +
          '</div>'
        )
      : '';

    // Ensure uiViewStep is a valid step id
    var uiViewStep = state.uiViewStep || 'airtable';
    if (WIZARD_STEPS.indexOf(uiViewStep) === -1) { uiViewStep = 'airtable'; }

    var draftContextBanner = draftLifecycle
      ? (
        '<section id="workspace-lifecycle-banner" tabindex="-1" class="' + draftLifecycle.toneClass + ' mb-5">' +
        '<p class="font-medium">' + escapeHtml(draftLifecycle.heading) + '</p>' +
        '<p class="mt-1">' + escapeHtml(draftLifecycle.message) + '</p>' +
        '<p class="mt-2 text-sm font-semibold">Editable wizard restored inside submissions.</p>' +
        '</section>'
      )
      : '';

    // Build step statuses for the top nav
    var stepStates = WIZARD_STEPS.map(function (stepId) {
      return {
        id: stepId,
        status: resolveStepStatus(stepId, workflowContext, activeStep),
      };
    });

    var wizardNavProps = {
      stepStates: stepStates,
      uiViewStep: uiViewStep,
      stepLabels: WIZARD_STEP_LABELS,
      escapeHtml: escapeHtml
    };
    var stepNavMarkup = nav.renderWizardNav(
      wizardNavProps.stepStates,
      wizardNavProps.uiViewStep,
      wizardNavProps.stepLabels,
      wizardNavProps.escapeHtml
    );

    var stepAirtableContent = airtableStep.renderAirtableStep({
      state: state,
      draft: draft,
      workflowContext: workflowContext,
      escapeHtml: escapeHtml,
      buildReleaseMonthOptions: buildReleaseMonthOptions
    });

    var stepIntakeContent = intakeStep.renderIntakeStep({
      state: state,
      qcResult: qcResult,
      qcStatusMarkup: qcStatusMarkup,
      checklistMarkup: checklistMarkup,
      hasFolder: hasFolder,
      missingFolders: missingFolders,
      escapeHtml: escapeHtml,
      buildStructureGateMessage: buildStructureGateMessage,
      buildMissingRequiredFolderGuidance: buildMissingRequiredFolderGuidance,
      buildRemediationMarkup: buildRemediationMarkup
    });

    var stepReviewContent = reviewStep.renderReviewStep({
      state: state,
      canSubmit: canSubmit,
      readiness: readiness,
      uploadState: activeUpload,
      escapeHtml: escapeHtml,
      buildReadinessSummaryText: buildReadinessSummaryText,
      buildReadinessBlockersMarkup: buildReadinessBlockersMarkup
    });

    var stepContentMap = {
      airtable: stepAirtableContent,
      intake: stepIntakeContent,
      review: stepReviewContent,
    };

    if (uiViewStep === 'qc') { uiViewStep = 'intake'; }

    return (
      '<div class="space-y-8">' +
      draftContextBanner +
      // Step nav
      '<div>' +
      '<div class="grid grid-cols-3 gap-3">' + stepNavMarkup + '</div>' +
      '</div>' +
      // Active step panel
      '<div class="bg-brand-surface-alt rounded-xl border border-brand-border p-6 md:p-8">' +
      (stepContentMap[uiViewStep] || stepContentMap.airtable) +
      '</div>' +
      '</div>'
    );
  }

  function renderSubmissionDetail() {
    var submission = null;
    var i;
    for (i = 0; i < state.submissions.length; i += 1) {
      if (state.submissions[i].submissionId === state.selectedSubmissionId) {
        submission = state.submissions[i];
        break;
      }
    }
    return submissionDetailComp.renderSubmissionDetail({
      submission: submission,
      selectedTimeline: state.selectedTimeline,
      escapeHtml: escapeHtml
    });
  }

  function renderHistory() {
    return historyPanel.renderHistory({
      submissions: state.submissions,
      timelinesBySubmissionId: state.timelinesBySubmissionId,
      escapeHtml: escapeHtml
    });
  }

  function renderMainPanel() {
    var target = document.getElementById('workspace-main-panel');
    if (!target) { return; }

    if (state.mode === 'detail') {
      target.innerHTML = renderSubmissionDetail();
    } else if (state.mode === 'draft') {
      target.innerHTML = renderDraftEditor();
      var releaseEl = document.getElementById('workspace-release-month');
      if (releaseEl && state.draft.releaseMonth) {
        releaseEl.value = state.draft.releaseMonth;
      }
    } else {
      // No draft/detail active — show history
      target.innerHTML = renderHistory();
    }

    wireMainPanelActions();
    applyPendingFocusTarget();
  }

  function render() {
    renderMainPanel();
  }

  function openSubmission(submissionId, options) {
    var selected = getSubmissionById(submissionId);
    var launchMode = resolveSubmissionLaunchMode(selected, options && options.mode);
    var switchingSubmission = state.selectedSubmissionId !== submissionId;
    var uploadState = getStoredOrSubmissionUploadState(selected);
    state.pendingShortcut = '';
    state.selectedSubmissionId = submissionId;
    state.mode = launchMode;
    state.isSubmitting = false;

    if (switchingSubmission) {
      state.selectedFolder = null;
      state.missingTopLevelFolders = [];
      state.isQcRunning = false;
      state.qcRunStatus = null;
    }

    if (selected) {
      hydrateAirtableStateFromSubmission(selected);
      state.draft = {
        submissionId: selected.submissionId,
        packName: selected.packName || '',
        labelName: selected.labelName || (state.profile && state.profile.labelName ? state.profile.labelName : ''),
        releaseMonth: selected.releaseMonth || '',
        notes: selected.notes || '',
        tags: Array.isArray(selected.tags) ? selected.tags.slice() : [],
      };
      if (!state.qcResults[selected.submissionId]) {
        state.qcResults[selected.submissionId] = null;
      }
      var restoredDraftContext = readDraftContext(selected.submissionId);
      if (restoredDraftContext && restoredDraftContext.selectedFolder) {
        var restoredFiles = Array.isArray(restoredDraftContext.selectedFolder.files)
          ? restoredDraftContext.selectedFolder.files.map(function (entry) {
              return {
                relativePath: String(entry && entry.relativePath ? entry.relativePath : '').trim(),
                sizeBytes: coerceNonNegativeInteger(entry && entry.sizeBytes, 0),
                mimeType: String(entry && entry.mimeType ? entry.mimeType : 'application/octet-stream').trim(),
              };
            }).filter(function (entry) { return entry.relativePath.length > 0; })
          : [];
        state.selectedFolder = {
          path: String(restoredDraftContext.selectedFolder.path || '').trim(),
          fileCount: restoredFiles.length > 0
            ? restoredFiles.length
            : coerceNonNegativeInteger(restoredDraftContext.selectedFolder.fileCount, 0),
          topLevelFolders: Array.isArray(restoredDraftContext.selectedFolder.topLevelFolders)
            ? restoredDraftContext.selectedFolder.topLevelFolders
            : [],
          files: restoredFiles,
        };
        state.missingTopLevelFolders = Array.isArray(restoredDraftContext.missingTopLevelFolders)
          ? restoredDraftContext.missingTopLevelFolders
          : resolveMissingRequiredFolders(state.selectedFolder.topLevelFolders || []);
      }
      if (restoredDraftContext && Object.prototype.hasOwnProperty.call(restoredDraftContext, 'qcPassed')) {
        state.qcPassed[selected.submissionId] = Boolean(restoredDraftContext.qcPassed);
      }
      if (restoredDraftContext && restoredDraftContext.qcResult && typeof restoredDraftContext.qcResult === 'object') {
        state.qcResults[selected.submissionId] = restoredDraftContext.qcResult;
      }
    }

    if (uploadState && uploadState.submissionId === submissionId) {
      applyUploadState(uploadState, {
        persist: Boolean(uploadState.handoffId),
        render: false,
      });
      state.isSubmitting = isSubmissionUploading(selected);
    } else {
      if (!state.activeUpload || !isActiveUploadStatus(state.activeUpload.status)) {
        clearActiveUploadState();
      }
      state.isSubmitting = isSubmissionUploading(selected);
    }

    state.selectedTimeline = state.timelinesBySubmissionId[submissionId] || [];
    state.uiViewStep = launchMode === 'draft'
      ? resolveDraftRestoreStep(selected)
      : state.uiViewStep;
    if (isSubmissionUploading(selected)) {
      state.uiViewStep = 'review';
      state.isSubmitting = true;
      if (uploadState && uploadState.handoffId && !isTerminalUploadStatus(uploadState.status)) {
        startUploadStatusPolling();
      }
    }
    scheduleFocusTarget('workspace-lifecycle-banner');

    render();
    focusElementById('workspace-lifecycle-banner');
    loadTimeline(submissionId);
  }

  function beginNewDraft() {
    state.mode = 'draft';
    state.selectedSubmissionId = null;
    state.selectedTimeline = [];
    state.uiViewStep = 'airtable';
    state.pendingShortcut = '';
    state.draft = {
      submissionId: '',
      packName: '',
      labelName: state.profile && state.profile.labelName ? state.profile.labelName : '',
      releaseMonth: '',
      notes: '',
      tags: [],
    };
    state.airtable = {
      formCompleted: false,
      payloadChecksum: '',
      syncStatus: null,
      recordId: '',
      recordUrl: '',
      lastSyncedAt: '',
      lastErrorCode: '',
      lastErrorDetail: '',
      mappedPayload: null,
    };
    state.selectedFolder = null;
    state.missingTopLevelFolders = [];
    state.isQcRunning = false;
    state.qcRunStatus = null;
    scheduleFocusTarget('workspace-pack-name');
    renderMainPanel();
  }

  function applySubmissionsShortcut(shortcut) {
    var normalized = normalizeSubmissionsShortcutDetail(shortcut);
    var value = normalized.shortcut || (normalized.submissionId ? 'open-submission' : '');
    if (!value) { return; }
    if (state.submissions.length === 0 && value !== 'create') {
      state.pendingShortcut = normalized;
      void loadSubmissions();
      return;
    }
    if (value === 'create') {
      beginNewDraft();
      return;
    }
    if (value === 'history') {
      state.pendingShortcut = '';
      state.mode = 'list';
      state.selectedSubmissionId = null;
      state.selectedTimeline = [];
      renderMainPanel();
      return;
    }
    if (value === 'open-submission') {
      var targetSubmissionId = normalized.submissionId;
      if (targetSubmissionId) {
        openSubmission(targetSubmissionId, { mode: normalized.submissionMode });
        return;
      }
      state.pendingShortcut = '';
      state.mode = 'list';
      state.selectedSubmissionId = null;
      state.selectedTimeline = [];
      renderMainPanel();
      return;
    }
    if (value === 'needs-action') {
      var needsActionTargetSubmissionId = normalized.submissionId || resolveNeedsActionTargetSubmissionId(
        state.submissions,
        state.timelinesBySubmissionId
      );
      if (needsActionTargetSubmissionId) {
        openSubmission(needsActionTargetSubmissionId, { mode: normalized.submissionMode });
        return;
      }
      state.pendingShortcut = '';
      state.mode = 'detail';
      if (!state.selectedSubmissionId && state.submissions.length > 0) {
        state.selectedSubmissionId = state.submissions[0].submissionId;
      }
      renderMainPanel();
      return;
    }
  }

  function navigateToWizardStep(stepId) {
    if (WIZARD_STEPS.indexOf(stepId) === -1) { return; }
    syncDraftStateFromForm();
    showFeedback('', '');
    state.uiViewStep = stepId;
    renderMainPanel();
  }

  function wireMainPanelActions() {
    var panel = document.getElementById('workspace-main-panel');

    // Delegate wizard step nav clicks (top badges + Next/Back buttons)
    if (panel) {
      panel.addEventListener('click', function (event) {
        var stepBtn = event.target && typeof event.target.closest === 'function'
          ? event.target.closest('[data-wizard-step]')
          : null;
        if (stepBtn) {
          event.preventDefault();
          navigateToWizardStep(stepBtn.getAttribute('data-wizard-step'));
          return;
        }
        var nextBtn = event.target && typeof event.target.closest === 'function'
          ? event.target.closest('[data-wizard-next]')
          : null;
        if (nextBtn) {
          event.preventDefault();
          navigateToWizardStep(nextBtn.getAttribute('data-wizard-next'));
          return;
        }
        var uploadControlBtn = event.target && typeof event.target.closest === 'function'
          ? event.target.closest('[data-upload-control]')
          : null;
        if (uploadControlBtn) {
          event.preventDefault();
          handleUploadControlAction(uploadControlBtn.getAttribute('data-upload-control'));
        }
      });
    }

    var backBtn = document.getElementById('workspace-back-to-list');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        state.mode = 'list';
        state.selectedSubmissionId = null;
        renderMainPanel();
      });
    }

    var folderButton = document.getElementById('workspace-select-pack-folder');
    if (folderButton) {
      folderButton.addEventListener('click', function () {
        handleSelectPackFolder();
      });
    }

    var airtableCompleteButton = document.getElementById('workspace-airtable-complete');
    if (airtableCompleteButton) {
      airtableCompleteButton.addEventListener('click', function () {
        handleCompleteAirtableStep();
      });
    }

    var airtableResetButton = document.getElementById('workspace-airtable-reset');
    if (airtableResetButton) {
      airtableResetButton.addEventListener('click', function () {
        handleResetAirtableStep();
      });
    }

    var saveButton = document.getElementById('workspace-save-metadata');
    if (saveButton) {
      saveButton.addEventListener('click', function () {
        saveMetadata(true);
      });
    }

    var qcButton = document.getElementById('workspace-run-qc');
    if (qcButton) {
      qcButton.addEventListener('click', function () {
        runQcCheck();
      });
    }

    var submitButton = document.getElementById('workspace-submit-review');
    if (submitButton) {
      submitButton.addEventListener('click', function () {
        if (state.isSubmitting) { return; }
        handleSubmitForReview();
      });
    }

    var reopenButton = document.getElementById('workspace-reopen-edit');
    if (reopenButton) {
      reopenButton.addEventListener('click', function () {
        if (reopenButton.disabled) { return; }
        state.mode = 'draft';
        state.uiViewStep = 'airtable';
        renderMainPanel();
        focusElementById('workspace-pack-name');
      });
    }
  }

  function wire() {
    var root = document.getElementById('view-submissions');
    if (!root) { return; }

    if (typeof window !== 'undefined' && !window.electronAPI && window.fileeaters) {
      window.electronAPI = window.fileeaters;
    }

    if (state.autosaveTimer) {
      clearInterval(state.autosaveTimer);
    }
    stopUploadStatusPolling();

    state.autosaveTimer = setInterval(function () {
      if (state.mode !== 'draft') { return; }
      saveMetadata(false);
    }, 30000);

    root.addEventListener('click', function (event) {
      var createBtn = event.target && typeof event.target.closest === 'function'
        ? event.target.closest('[data-workspace-create]')
        : null;
      if (createBtn) {
        event.preventDefault();
        beginNewDraft();
        return;
      }

      var openBtn = event.target && typeof event.target.closest === 'function'
        ? event.target.closest('[data-workspace-open]')
        : null;
      if (openBtn) {
        event.preventDefault();
        openSubmission(openBtn.getAttribute('data-workspace-open'));
        return;
      }

      var needsActionBtn = event.target && typeof event.target.closest === 'function'
        ? event.target.closest('[data-workspace-open-needs-action]')
        : null;
      if (needsActionBtn) {
        event.preventDefault();
        applySubmissionsShortcut('needs-action');
      }
    });

    if (!root.dataset.submissionsShortcutBound && typeof window !== 'undefined' && window.addEventListener) {
      root.dataset.submissionsShortcutBound = 'true';
      window.addEventListener('fileeaters:submissions-shortcut', function (event) {
        var detail = event && event.detail ? event.detail : {};
        var normalized = normalizeSubmissionsShortcutDetail(detail);
        if ((normalized.shortcut === 'open-submission' || normalized.shortcut === 'needs-action') && normalized.submissionId) {
          state.pendingShortcut = normalized;
          void loadSubmissions();
          return;
        }
        applySubmissionsShortcut(normalized);
      });
    }

    Promise.all([loadCreatorProfile(), loadSubmissions()])
      .then(function (results) {
        var profileResult = results[0] || { ok: true };
        var submissionsResult = results[1] || { ok: false, kind: 'error' };
        if (submissionsResult.ok && submissionsResult.kind === 'no_data') {
          showFeedback('warning', 'No submissions yet. Create a draft, then save metadata to begin.');
          return;
        }
        if (!profileResult.ok && submissionsResult.ok) {
          showFeedback(
            'warning',
            'Submission data loaded, but profile defaults are unavailable. Continue safely and retry profile sync after API recovery.'
          );
          return;
        }
        if (!profileResult.ok && !submissionsResult.ok && profileResult.kind !== 'backend_unreachable') {
          showFeedback('warning', 'Workspace loaded with limited data. Retry to recover backend sync.');
        }
      })
      .catch(function () {
        showFeedback('warning', 'Workspace loaded with limited data. Retry to recover backend sync.');
      });
  }

  function refresh() {
    return Promise.all([loadCreatorProfile(), loadSubmissions()]);
  }

  function getTemplate() {
    return (
      '<section class="fe-view hidden" data-view="submissions" id="view-submissions">' +
      '<div class="fe-view-inner fe-page-shell">' +
      '<header class="fe-view-header">' +
      '<div>' +
      '<p class="fe-view-eyebrow">Creator</p>' +
      '<h2 class="fe-view-title">Creator Workspace</h2>' +
      '</div>' +
      '<div class="flex gap-3">' +
      '<button type="button" data-workspace-create class="auth-button">New Draft</button>' +
      '</div>' +
      '</header>' +
      '<p id="workspace-feedback" class="auth-feedback hidden mb-4" aria-live="polite" aria-atomic="true" role="status" tabindex="-1"></p>' +
      '<main id="workspace-main-panel" class="fe-surface"></main>' +
      '</div>' +
      '</section>'
    );
  }

  return {
    getTemplate: getTemplate,
    refresh: refresh,
    wire: wire,
    __test: {
      buildCanonicalReadiness: buildCanonicalReadiness,
      buildCreatorRemediationItems: buildCreatorRemediationItems,
      buildManifestChecksum: buildManifestChecksum,
      buildManifestFilesAndChecksum: buildManifestFilesAndChecksum,
      buildManifestFilesFromSelection: buildManifestFilesFromSelection,
      buildReleaseMonthOptions: buildReleaseMonthOptions,
      buildQcRunStatusMarkup: buildQcRunStatusMarkup,
      digestSha256Hex: digestSha256Hex,
      logWorkspaceOptionalDependencyFailure: logWorkspaceOptionalDependencyFailure,
      mapWorkflowBlockersToReadiness: mapWorkflowBlockersToReadiness,
      mergeDraftState: mergeDraftState,
      normalizeSubmissionsShortcutDetail: normalizeSubmissionsShortcutDetail,
      buildReadinessSummaryText: buildReadinessSummaryText,
      buildRemediationMarkup: buildRemediationMarkup,
      buildSubmitBlockedFeedbackMessage: buildSubmitBlockedFeedbackMessage,
      evaluateSubmitReadiness: evaluateSubmitReadiness,
      hasDraftAfterRejectedLifecycleEvent: hasDraftAfterRejectedLifecycleEvent,
      hasRejectedLifecycleEvent: hasRejectedLifecycleEvent,
      hasValidReleaseMonth: hasValidReleaseMonth,
      normalizeQcFinding: normalizeQcFinding,
      resolveDraftRestoreStep: resolveDraftRestoreStep,
      resolveDraftFocusTargetForReadiness: resolveDraftFocusTargetForReadiness,
      resolveNeedsActionDescriptor: resolveNeedsActionDescriptor,
      resolveNeedsActionTargetSubmissionId: resolveNeedsActionTargetSubmissionId,
      resolveSubmissionLaunchMode: resolveSubmissionLaunchMode,
      resolveLifecycleVisibility: resolveLifecycleVisibility,
      resolveSubmitGateStatus: resolveSubmitGateStatus,
      getSubmissionById: getSubmissionById,
      toCreatorSafeSurfaceMessage: toCreatorSafeSurfaceMessage,
    },
  };
});
