/* QC Results View — report + policy editor with existing IDs */
(function (global, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (global && typeof global === 'object') { global.viewQcResults = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    function getWrappers() {
        if (typeof globalThis !== 'undefined' && globalThis.flowbiteWrappers) {
            return globalThis.flowbiteWrappers;
        }
        if (typeof window !== 'undefined' && window.flowbiteWrappers) {
            return window.flowbiteWrappers;
        }
        return null;
    }

    function wrapControl(name, options, fallbackClass) {
        var wrappers = getWrappers();
        if (wrappers && typeof wrappers[name] === 'function') {
            return wrappers[name](options || {});
        }
        return { className: fallbackClass || '', attrString: '' };
    }

    function getTemplate() {
        var navButton = wrapControl('button', {
            control: 'qc-results-nav-submissions',
            type: 'button',
            tone: 'ghost',
            size: 'sm',
            className: 'px-0 py-0 text-xs text-brand-accent underline underline-offset-4',
        }, 'fe-link-btn');
        var submissionSelect = wrapControl('select', { control: 'qc-report-submission-selector' }, 'auth-input');
        var runSelect = wrapControl('select', { control: 'qc-report-run-selector' }, 'auth-input');
        var severitySelect = wrapControl('select', { control: 'qc-report-severity-filter' }, 'auth-input');
        var categorySelect = wrapControl('select', { control: 'qc-report-category-filter' }, 'auth-input');
        var rerunBtn = wrapControl('button', { control: 'qc-report-rerun-button', type: 'button', tone: 'primary' }, 'auth-button');
        var exportBtn = wrapControl('button', { control: 'qc-report-export-button', type: 'button', tone: 'secondary' }, 'auth-button-secondary');
        var policyBtn = wrapControl('button', { control: 'qc-policy-button', type: 'button', tone: 'secondary' }, 'auth-button-secondary');
        var policySaveBtn = wrapControl('button', { control: 'qc-policy-save-button', type: 'button', tone: 'secondary' }, 'auth-button-secondary');
        var policyJson = wrapControl('textarea', { control: 'qc-policy-json', className: 'min-h-40 font-mono text-xs' }, 'auth-input min-h-40 font-mono text-xs');
        return `
<section class="fe-view hidden" data-view="qc-results" id="view-qc-results">
  <div class="fe-view-inner space-y-6">
    <header class="fe-view-header items-end gap-4">
      <div>
        <p class="fe-view-eyebrow">Deprecated</p>
        <h2 class="fe-view-title">Legacy QC Report</h2>
      </div>
    </header>
    <p class="auth-feedback warning mb-4">Creator workflow moved to <button class="${navButton.className}" ${navButton.attrString} data-nav="submissions">Submissions</button>.</p>
    <div class="grid gap-6 lg:grid-cols-3">
      <div class="fe-card bg-brand-surface-alt/50 border border-brand-border/60 shadow-brand-sm">
        <p class="fe-card-title mb-2">Summary</p>
        <p id="qc-results-summary" class="text-sm text-brand-text mb-3">Run QC to load report details.</p>
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center rounded-brand-pill border border-brand-danger bg-red-50 px-3 py-1 text-xs font-semibold text-brand-danger">Blocking: <span id="qc-report-blocking-count" class="ml-1">0</span></span>
          <span class="inline-flex items-center rounded-brand-pill border border-amber-500 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Warnings: <span id="qc-report-warning-count" class="ml-1">0</span></span>
          <span id="qc-report-pass-fail" class="inline-flex items-center rounded-brand-pill border border-brand-border bg-brand-surface-alt px-3 py-1 text-xs font-semibold text-brand-text">NOT RUN</span>
        </div>
        <p id="qc-report-resolved-summary" class="mt-3 text-xs text-brand-text">No previous run to compare.</p>
      </div>
      <div class="fe-card lg:col-span-2 bg-brand-surface-alt/50 border border-brand-border/60 shadow-brand-sm">
        <p class="fe-card-title mb-3">Filters &amp; Actions</p>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label class="fe-label" for="qc-report-submission-selector">
            Submission
            <select id="qc-report-submission-selector" class="${submissionSelect.className} mt-1" ${submissionSelect.attrString}>
              <option value="">Loading submissions…</option>
            </select>
          </label>
          <label class="fe-label" for="qc-report-run-selector">
            Run
            <select id="qc-report-run-selector" class="${runSelect.className} mt-1" ${runSelect.attrString}>
              <option value="">Select a submission</option>
            </select>
          </label>
          <label class="fe-label" for="qc-report-severity-filter">
            Severity
            <select id="qc-report-severity-filter" class="${severitySelect.className} mt-1" ${severitySelect.attrString}>
              <option value="all">All</option>
              <option value="blocking">Blocking</option>
              <option value="warning">Warning</option>
            </select>
          </label>
          <label class="fe-label" for="qc-report-category-filter">
            Category
            <select id="qc-report-category-filter" class="${categorySelect.className} mt-1" ${categorySelect.attrString}>
              <option value="all">All</option>
              <option value="folder">Folder</option>
              <option value="audio-zip">Audio ZIP</option>
              <option value="samples">Samples</option>
              <option value="demo">Demo</option>
              <option value="description">Description</option>
              <option value="artwork">Artwork</option>
              <option value="presets">Presets</option>
              <option value="midi">MIDI</option>
            </select>
          </label>
          <div class="flex items-end">
            <button id="qc-report-rerun-button" class="${rerunBtn.className} w-full" ${rerunBtn.attrString}>Re-run QC</button>
          </div>
          <div class="flex items-end">
            <button id="qc-report-export-button" class="${exportBtn.className} w-full" ${exportBtn.attrString}>Export findings</button>
          </div>
        </div>
        <p id="qc-report-feedback" class="auth-feedback hidden mt-3" aria-live="polite"></p>
      </div>
      <div class="fe-card bg-brand-surface-alt/50 border border-brand-border/60 shadow-brand-sm">
        <h3 class="fe-card-title mb-3">Findings</h3>
        <div id="qc-results-findings" class="space-y-4"></div>
      </div>
      <div class="fe-card lg:col-span-2 bg-brand-surface-alt/50 border border-brand-border/60 shadow-brand-sm">
        <h3 class="fe-card-title mb-3">Policy Editor</h3>
        <div class="flex flex-wrap gap-2 mb-3">
          <button id="qc-policy-button" class="${policyBtn.className}" ${policyBtn.attrString}>Load Active Policy</button>
          <button id="qc-policy-save-button" class="${policySaveBtn.className}" ${policySaveBtn.attrString}>Save Policy</button>
        </div>
        <label class="fe-label" for="qc-policy-json">Policy JSON</label>
        <textarea id="qc-policy-json" class="${policyJson.className}" ${policyJson.attrString} spellcheck="false">{"policyId":"default-wave2-policy","ruleSetVersion":"2026.02.wave2-baseline","rules":[{"ruleId":"pack.folder.audio.required","enabled":true,"blockingOverride":null},{"ruleId":"pack.audio.zip.naming","enabled":true,"blockingOverride":null},{"ruleId":"pack.audio.zip.size","enabled":true,"blockingOverride":null},{"ruleId":"pack.sample-count.max","enabled":true,"blockingOverride":null},{"ruleId":"pack.naming.unsupported-tokens","enabled":true,"blockingOverride":false}]}</textarea>
        <pre id="qc-policy-output" class="fe-pre mt-3"></pre>
      </div>
    </div>
  </div>
</section>`;
    }

    return { getTemplate: getTemplate };
});
