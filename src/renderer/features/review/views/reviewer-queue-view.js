/* Reviewer Queue view wrapper delegated to src/renderer/review/review-queue-page.js */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.viewReviewerQueue = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function getPage() {
    return typeof globalThis !== "undefined" ? globalThis.reviewQueuePage : null;
  }

  function getTemplate() {
    var page = getPage();
    if (!page || typeof page.getTemplate !== "function") {
      return '<section class="fe-view hidden" data-view="reviewer-queue"><div class="fe-view-inner"><div class="fe-card"><p class="auth-subtle">Review queue module unavailable.</p></div></div></section>';
    }
    return page.getTemplate();
  }

  function wire(options) {
    var page = getPage();
    if (page && typeof page.wire === "function") {
      page.wire(options || {});
    }
  }

  return {
    getTemplate: getTemplate,
    wire: wire,
  };
});
