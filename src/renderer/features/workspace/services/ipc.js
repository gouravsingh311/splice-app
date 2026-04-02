(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceIpc = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function getBridge() {
    return typeof window !== 'undefined' && window.fileeaters ? window.fileeaters : null;
  }

  async function selectFolder() {
    var bridge = getBridge();
    if (!bridge || !bridge.intake || !bridge.intake.selectFolder) {
      throw new Error('Folder picker IPC is unavailable.');
    }
    return bridge.intake.selectFolder();
  }

  async function loadProfile(actorId) {
    var bridge = getBridge();
    if (!bridge || !bridge.creator || !bridge.creator.profile) {
      throw new Error('bridge_unavailable');
    }
    return bridge.creator.profile.get({ actorId: actorId, userId: 'me' });
  }

  async function listSubmissions(actorId) {
    var bridge = getBridge();
    if (!bridge || !bridge.submissions || !bridge.submissions.list) {
      throw new Error('bridge_unavailable');
    }
    return bridge.submissions.list({ creatorId: actorId });
  }

  async function getTimeline(submissionId, actorId) {
    var bridge = getBridge();
    if (!bridge || !bridge.submissions || !bridge.submissions.timeline) {
      throw new Error('bridge_unavailable');
    }
    return bridge.submissions.timeline({
      submissionId: submissionId,
      creatorId: actorId,
    });
  }

  async function createDraft(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.submissions || !bridge.submissions.createDraft) {
      throw new Error('bridge_unavailable');
    }
    return bridge.submissions.createDraft(payload);
  }

  async function updateMetadata(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.submissions || !bridge.submissions.updateMetadata) {
      throw new Error('bridge_unavailable');
    }
    return bridge.submissions.updateMetadata(payload);
  }

  async function syncAirtable(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.submissions || !bridge.submissions.syncAirtable) {
      throw new Error('bridge_unavailable');
    }
    return bridge.submissions.syncAirtable(payload);
  }

  async function resetAirtable(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.submissions || !bridge.submissions.resetAirtable) {
      throw new Error('bridge_unavailable');
    }
    return bridge.submissions.resetAirtable(payload);
  }

  async function transitionSubmission(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.submissions || !bridge.submissions.transition) {
      throw new Error('bridge_unavailable');
    }
    return bridge.submissions.transition(payload);
  }

  async function evaluatePack(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.qc || !bridge.qc.evaluatePack) {
      throw new Error('bridge_unavailable');
    }
    return bridge.qc.evaluatePack(payload);
  }

  async function startIntakeSession(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.intake || !bridge.intake.startSession) {
      throw new Error('bridge_unavailable');
    }
    return bridge.intake.startSession(payload);
  }

  async function putManifest(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.intake || !bridge.intake.putManifest) {
      throw new Error('bridge_unavailable');
    }
    return bridge.intake.putManifest(payload);
  }

  async function createHandoff(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.intake || !bridge.intake.createHandoff) {
      throw new Error('bridge_unavailable');
    }
    return bridge.intake.createHandoff(payload);
  }

  async function lockSubmissionFiles(payload) {
    var bridge = getBridge();
    if (!bridge || !bridge.intake || !bridge.intake.lockSubmissionFiles) {
      throw new Error('bridge_unavailable');
    }
    return bridge.intake.lockSubmissionFiles(payload);
  }

  return {
    getBridge: getBridge,
    selectFolder: selectFolder,
    loadProfile: loadProfile,
    listSubmissions: listSubmissions,
    getTimeline: getTimeline,
    createDraft: createDraft,
    updateMetadata: updateMetadata,
    syncAirtable: syncAirtable,
    resetAirtable: resetAirtable,
    transitionSubmission: transitionSubmission,
    evaluatePack: evaluatePack,
    startIntakeSession: startIntakeSession,
    putManifest: putManifest,
    createHandoff: createHandoff,
    lockSubmissionFiles: lockSubmissionFiles,
  };
});
