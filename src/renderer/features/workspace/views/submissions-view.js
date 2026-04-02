/* Submissions view delegates to Creator Workspace module (PRD-02). */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.viewSubmissions = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function fallbackTemplate() {
    return '<section class="fe-view hidden" data-view="submissions" id="view-submissions">' +
      '<div class="fe-view-inner">' +
      '<div class="rounded-lg border border-brand-border bg-brand-surface p-5 shadow-brand-sm">' +
      '<p class="text-sm text-brand-text">Submissions workspace is unavailable. Next step: refresh the app to reload this view.</p>' +
      '</div>' +
      '</div>' +
      '</section>';
  }

  function getWorkspaceModule() {
    if (typeof window === 'undefined') { return null; }
    return window.creatorWorkspacePage || null;
  }

  function getTemplate() {
    var moduleApi = getWorkspaceModule();
    if (!moduleApi || typeof moduleApi.getTemplate !== 'function') {
      return fallbackTemplate();
    }
    return moduleApi.getTemplate();
  }

  function wire() {
    var moduleApi = getWorkspaceModule();
    if (!moduleApi || typeof moduleApi.wire !== 'function') {
      return;
    }
    moduleApi.wire();
  }

  function refresh() {
    var moduleApi = getWorkspaceModule();
    if (!moduleApi || typeof moduleApi.refresh !== 'function') {
      return Promise.resolve();
    }
    return moduleApi.refresh();
  }

  return {
    getTemplate: getTemplate,
    refresh: refresh,
    wire: wire,
  };
});
