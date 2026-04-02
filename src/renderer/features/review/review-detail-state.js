/* Review Detail shared state/helpers for PRD-08 decision flow. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewDetailState = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createReviewDetailState(globalScope) {
    var scope = globalScope || {};

    function getDocument() {
      return scope.document || (scope.window && scope.window.document) || null;
    }

    function getRuntimeGlobal() {
      return scope;
    }

    function actorContext() {
      var runtimeGlobal = getRuntimeGlobal();
      if (runtimeGlobal.reviewConsoleStore && runtimeGlobal.reviewConsoleStore.getActor) {
        return runtimeGlobal.reviewConsoleStore.getActor();
      }
      return { actorId: "desktop-local-reviewer", actorRole: "reviewer" };
    }

    function expose(name, value) {
      scope[name] = value;
      if (scope.window && scope.window !== scope) {
        scope.window[name] = value;
      }
      return value;
    }

    return {
      state: {
        bridgeApi: null,
        currentSubmissionId: null,
        currentDetail: null,
        pendingAction: null,
        activeModalId: null,
        modalFocusRestoreEl: null,
      },
      getDocument: getDocument,
      getRuntimeGlobal: getRuntimeGlobal,
      actorContext: actorContext,
      expose: expose,
    };
  }

  return {
    createReviewDetailState: createReviewDetailState,
  };
});
