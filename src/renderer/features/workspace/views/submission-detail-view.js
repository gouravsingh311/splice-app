/* Submission Detail View */
(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.viewSubmissionDetail = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function getTemplate() {
    return `
<section class="fe-view hidden" data-view="submission-detail" id="view-submission-detail">
  <div class="fe-view-inner">
    <div id="submission-detail-shim-card" class="rounded-lg border border-brand-border bg-brand-surface p-6 shadow-brand-sm">
      <span class="inline-flex items-center rounded-full border border-brand-danger/30 bg-brand-danger/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-danger">Deprecated</span>
      <h2 class="mt-3 text-2xl font-semibold text-brand-text-strong">Submission Detail Moved</h2>
      <p class="mt-4 text-sm text-brand-text">
        This route is a fallback shim only. Submission lifecycle detail and reopen actions now live in submissions.
      </p>
      <div class="mt-5 flex flex-wrap gap-3">
        <button class="inline-flex items-center justify-center gap-2 rounded-brand-sm bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text-strong transition duration-fast ease-standard hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" data-ui-wrapper="button" data-ui-control="navigate-submissions" data-nav="submissions" type="button">Back to Submissions</button>
      </div>
    </div>
  </div>
</section>`;
  }

  function load() {
    return;
  }

  return { getTemplate: getTemplate, load: load };
});
