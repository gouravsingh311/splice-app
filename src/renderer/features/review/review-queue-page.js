/* Review Queue Page (PRD-08): reviewer queue table + filters + inline triage actions. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewQueuePage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function loadReviewModule(globalName, requirePath) {
    if (typeof globalThis !== "undefined" && globalThis[globalName]) {
      return globalThis[globalName];
    }
    if (typeof require === "function") {
      return require(requirePath);
    }
    throw new Error("Review queue dependency unavailable: " + globalName);
  }

  function createReviewQueuePage(globalScope) {
    var scope = globalScope || {};
    var utilsModule = loadReviewModule("reviewPageUtils", "./review-page-utils.js");
    var stateModule = loadReviewModule("reviewQueueState", "./review-queue-state.js");
    var renderModule = loadReviewModule("reviewQueueRender", "./review-queue-render.js");
    var actionsModule = loadReviewModule("reviewQueueActions", "./review-queue-actions.js");
    var ctx = {
      scope: scope,
      state: {
        bridgeApi: null,
        queueItems: [],
        filterDebounceId: null,
      },
      getDocument: function () {
        return scope.document || (scope.window && scope.window.document) || null;
      },
      getRuntimeGlobal: function () {
        return scope;
      },
      wrapControl: utilsModule.wrapControl,
      escapeHtml: utilsModule.escapeHtml,
      formatDate: utilsModule.formatDate,
      statusChip: utilsModule.statusChip,
    };

    Object.assign(ctx, stateModule.createReviewQueueState(ctx));
    Object.assign(ctx, renderModule.createReviewQueueRender(ctx));
    Object.assign(ctx, actionsModule.createReviewQueueActions(ctx));

    function expose(name, value) {
      scope[name] = value;
      if (scope.window && scope.window !== scope) {
        scope.window[name] = value;
      }
      return value;
    }

    var api = {
      getTemplate: ctx.getTemplate,
      wire: ctx.wire,
      __test: {
        getRiskRank: ctx.getRiskRank,
        getRiskLabel: ctx.getRiskLabel,
        sortForTriage: ctx.sortForTriage,
        applyClientFilters: ctx.applyClientFilters,
        isBackendUnreachable: ctx.isBackendUnreachable,
        resolveQueueState: ctx.resolveQueueState,
      },
    };

    expose("reviewQueuePage", api);
    return api;
  }

  return createReviewQueuePage(typeof globalThis !== "undefined" ? globalThis : this);
});
