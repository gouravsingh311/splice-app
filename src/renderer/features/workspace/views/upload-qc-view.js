/* Upload & QC View — 3-step flow with existing element IDs */
(function (global, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (global && typeof global === 'object') { global.viewUploadQc = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    function getTemplate() {
        return `
<section class="fe-view hidden" data-view="upload-qc" id="view-upload-qc">
  <div class="fe-view-inner">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <span class="inline-flex items-center rounded-full border border-brand-danger/30 bg-brand-danger/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-danger">Deprecated</span>
        <h2 class="mt-3 text-2xl font-semibold text-brand-text-strong">Legacy Upload &amp; QC</h2>
        <p class="mt-2 text-sm text-brand-text">This workflow is a legacy stub. Use Submissions for the live creator flow.</p>
      </div>
    </header>
    <div class="mt-6 rounded-lg border border-brand-border bg-brand-surface-alt p-4 text-sm text-brand-text" role="status">
      Creator workflow moved to <button class="inline-flex items-center font-semibold text-brand-accent transition-colors hover:text-brand-text-strong" data-ui-wrapper="button" data-ui-control="navigate-submissions" data-nav="submissions" type="button">Submissions</button>.
    </div>
    <ol class="mt-6 grid gap-3 md:grid-cols-3" aria-label="Legacy upload and QC steps">
      <li id="step-1" class="active rounded-lg border border-brand-accent bg-brand-surface-alt px-4 py-3 text-sm font-semibold text-brand-text-strong">
        <span class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-accent text-xs font-semibold text-brand-text-strong">1</span>
        Pack Details
      </li>
      <li id="step-2" class="rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-sm font-semibold text-brand-text">
        <span class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-surface-alt text-xs font-semibold text-brand-text">2</span>
        Run QC
      </li>
      <li id="step-3" class="rounded-lg border border-brand-border bg-brand-bg px-4 py-3 text-sm font-semibold text-brand-text">
        <span class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-surface-alt text-xs font-semibold text-brand-text">3</span>
        Results
      </li>
    </ol>
    <div class="mt-6 rounded-lg border border-brand-border bg-brand-surface p-6 shadow-brand-sm">
      <h3 class="text-lg font-semibold text-brand-text-strong">Pack Metadata</h3>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <label class="text-xs font-semibold uppercase tracking-[0.12em] text-brand-text/70" for="qc-submission-id">Submission ID</label>
          <input id="qc-submission-id" data-ui-wrapper="input" data-ui-control="qc-submission-id" class="mt-2 w-full rounded-brand-sm border border-brand-border bg-brand-surface-alt px-3 py-2 text-sm text-brand-text placeholder:text-brand-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" type="text" value="sub-local-1" placeholder="sub-local-1" />
        </div>
        <div>
          <label class="text-xs font-semibold uppercase tracking-[0.12em] text-brand-text/70" for="qc-pack-name">Pack Name</label>
          <input id="qc-pack-name" data-ui-wrapper="input" data-ui-control="qc-pack-name" class="mt-2 w-full rounded-brand-sm border border-brand-border bg-brand-surface-alt px-3 py-2 text-sm text-brand-text placeholder:text-brand-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" type="text" value="Label - Pack" placeholder="Label - Pack" />
        </div>
        <div>
          <label class="text-xs font-semibold uppercase tracking-[0.12em] text-brand-text/70" for="qc-folders">Top-Level Folders <span class="font-normal text-brand-text/60">(comma-separated)</span></label>
          <input id="qc-folders" data-ui-wrapper="input" data-ui-control="qc-folders" class="mt-2 w-full rounded-brand-sm border border-brand-border bg-brand-surface-alt px-3 py-2 text-sm text-brand-text placeholder:text-brand-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" type="text" value="Artwork,Audio,Description" />
        </div>
        <div>
          <label class="text-xs font-semibold uppercase tracking-[0.12em] text-brand-text/70" for="qc-audio-zip-name">Audio ZIP Filename</label>
          <input id="qc-audio-zip-name" data-ui-wrapper="input" data-ui-control="qc-audio-zip-name" class="mt-2 w-full rounded-brand-sm border border-brand-border bg-brand-surface-alt px-3 py-2 text-sm text-brand-text placeholder:text-brand-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" type="text" value="Label - Pack.zip" />
        </div>
        <div>
          <label class="text-xs font-semibold uppercase tracking-[0.12em] text-brand-text/70" for="qc-audio-zip-size">Audio ZIP Size (bytes)</label>
          <input id="qc-audio-zip-size" data-ui-wrapper="input" data-ui-control="qc-audio-zip-size" class="mt-2 w-full rounded-brand-sm border border-brand-border bg-brand-surface-alt px-3 py-2 text-sm text-brand-text placeholder:text-brand-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" type="number" value="220000" min="0" />
        </div>
        <div>
          <label class="text-xs font-semibold uppercase tracking-[0.12em] text-brand-text/70" for="qc-sample-count">Sample Count</label>
          <input id="qc-sample-count" data-ui-wrapper="input" data-ui-control="qc-sample-count" class="mt-2 w-full rounded-brand-sm border border-brand-border bg-brand-surface-alt px-3 py-2 text-sm text-brand-text placeholder:text-brand-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" type="number" value="320" min="0" />
        </div>
        <label class="flex items-center gap-2 text-sm text-brand-text md:col-span-2" for="qc-unsupported-tokens">
          <input id="qc-unsupported-tokens" data-ui-wrapper="input" data-ui-control="qc-unsupported-tokens" type="checkbox" class="h-4 w-4 rounded border-brand-border text-brand-accent focus:ring-brand-accent" />
          Contains unsupported name tokens
        </label>
      </div>
      <div class="mt-6 flex flex-wrap gap-3">
        <button id="qc-run-button" data-ui-wrapper="button" data-ui-control="qc-run" class="inline-flex items-center justify-center gap-2 rounded-brand-sm bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text-strong transition duration-fast ease-standard hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" type="button">Run QC Analysis</button>
        <button id="qc-rules-button" data-ui-wrapper="button" data-ui-control="qc-load-rules" class="inline-flex items-center justify-center gap-2 rounded-brand-sm border border-brand-border bg-brand-surface-alt px-4 py-2 text-sm font-semibold text-brand-text transition duration-fast ease-standard hover:bg-brand-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" type="button">Load Rules</button>
      </div>
      <p id="qc-feedback" class="auth-feedback hidden mt-4" aria-live="polite"></p>
      <p id="qc-report-summary" class="mt-2 text-sm text-brand-text/70"></p>
    </div>
    <div class="mt-4 rounded-lg border border-brand-border bg-brand-surface p-6 shadow-brand-sm">
      <h3 class="text-lg font-semibold text-brand-text-strong">QC Findings</h3>
      <pre id="qc-rules-output" class="mt-4 max-h-64 overflow-auto rounded-lg border border-brand-border bg-brand-bg p-4 text-xs text-brand-text"></pre>
    </div>
  </div>
</section>`;
    }

    return { getTemplate: getTemplate };
});
