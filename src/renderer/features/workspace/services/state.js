(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceState = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var state = {
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
    uploadProgress: 0,
    uploadStatus: '',
    pendingShortcut: '',
    isLoadingSubmissions: false,
    autosaveTimer: null,
    pendingFocusTargetId: '',
  };

  function get() {
    return state;
  }

  function update(updates) {
    Object.assign(state, updates);
  }

  function scheduleFocusTarget(targetId) {
    state.pendingFocusTargetId = String(targetId || '').trim();
  }

  function applyPendingFocusTarget() {
    if (!state.pendingFocusTargetId) {
      return;
    }
    var targetId = state.pendingFocusTargetId;
    state.pendingFocusTargetId = '';
    
    // Inline focusElementById to avoid circular dependencies
    if (typeof document === 'undefined') { return; }
    var target = document.getElementById(targetId);
    if (!target || typeof target.focus !== 'function') { return; }
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus();
  }

  return {
    get: get,
    update: update,
    scheduleFocusTarget: scheduleFocusTarget,
    applyPendingFocusTarget: applyPendingFocusTarget
  };
});
