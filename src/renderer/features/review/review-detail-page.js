/* Review Detail Page (PRD-08): metadata, QC findings, tags/flags, decisions. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewDetailPage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function loadReviewModule(globalName, requirePath) {
    if (typeof globalThis !== "undefined" && globalThis[globalName]) {
      return globalThis[globalName];
    }
    if (typeof require === "function") {
      return require(requirePath);
    }
    throw new Error("Review detail dependency unavailable: " + globalName);
  }

  function createReviewDetailPage(globalScope) {
    var scope = globalScope || {};
    var stateModule = loadReviewModule("reviewDetailState", "./review-detail-state.js");
    var utilsModule = loadReviewModule("reviewPageUtils", "./review-page-utils.js");
    var renderModule = loadReviewModule("reviewDetailRender", "./review-detail-render.js");
    var actionsModule = loadReviewModule("reviewDetailActions", "./review-detail-actions.js");
    var wireModule = loadReviewModule("reviewDetailWire", "./review-detail-wire.js");
    var stateApi = stateModule.createReviewDetailState(scope);
    var ctx = {
      scope: scope,
      state: stateApi.state,
      getDocument: stateApi.getDocument,
      getRuntimeGlobal: stateApi.getRuntimeGlobal,
      actorContext: stateApi.actorContext,
      wrapControl: utilsModule.wrapControl,
      escapeHtml: utilsModule.escapeHtml,
      formatDate: utilsModule.formatDate,
      statusChip: utilsModule.statusChip,
    };

    Object.assign(ctx, renderModule.createReviewDetailRender(ctx));
    Object.assign(ctx, actionsModule.createReviewDetailActions(ctx));
    Object.assign(ctx, wireModule.createReviewDetailWire(ctx));

    var api = {
      getTemplate: ctx.getTemplate,
      wire: ctx.wire,
    };

    stateApi.expose("reviewDetailPage", api);
    return api;
  }

  return createReviewDetailPage(typeof globalThis !== "undefined" ? globalThis : this);
});
