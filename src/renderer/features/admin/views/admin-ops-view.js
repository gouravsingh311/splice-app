/* Admin Ops view wrapper delegated to src/renderer/admin/admin-page.js */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.viewAdminOps = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function getPage() {
    return typeof globalThis !== "undefined" ? globalThis.adminPage : null;
  }

  function getTemplate() {
    var page = getPage();
    if (!page || typeof page.getTemplate !== "function") {
      return '<section class="fe-view hidden" data-view="admin-ops"><div class="fe-view-inner"><div class="fe-card"><p class="auth-subtle">Admin module unavailable.</p></div></div></section>';
    }
    return page.getTemplate();
  }

  function wire(options) {
    var page = getPage();
    if (page && typeof page.wire === "function") {
      return page.wire(options || {});
    }
    return undefined;
  }

  return {
    getTemplate: getTemplate,
    wire: wire,
  };
});

