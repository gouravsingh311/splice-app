/* Shared review page helpers for PRD-08 queue/detail surfaces. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewPageUtils = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function loadReviewModule(globalName, requirePath) {
    if (typeof globalThis !== "undefined" && globalThis[globalName]) {
      return globalThis[globalName];
    }
    if (typeof require === "function") {
      return require(requirePath);
    }
    throw new Error("Review page dependency unavailable: " + globalName);
  }

  function getWrappers() {
    if (typeof globalThis !== "undefined" && globalThis.flowbiteWrappers) {
      return globalThis.flowbiteWrappers;
    }
    if (typeof window !== "undefined" && window.flowbiteWrappers) {
      return window.flowbiteWrappers;
    }
    return null;
  }

  function wrapControl(name, options, fallbackClass) {
    var wrappers = getWrappers();
    if (wrappers && typeof wrappers[name] === "function") {
      return wrappers[name](options || {});
    }
    return { className: fallbackClass || "", attrString: "" };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString();
  }

  function statusChip(state) {
    var normalized = String(state || "").toLowerCase().replace(/_/g, "-");
    return '<span class="fe-status-chip ' + normalized +
      ' inline-flex items-center rounded-brand-pill border border-brand-border/60 bg-brand-surface-alt/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-text">' +
      escapeHtml(normalized.replace(/-/g, " ")) + "</span>";
  }

  return {
    loadReviewModule: loadReviewModule,
    getWrappers: getWrappers,
    wrapControl: wrapControl,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    statusChip: statusChip,
  };
});
