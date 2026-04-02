(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceIntakeStep = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /**
   * @param {Object} props
   * - state: The full workspace state
   * - qcResult: The resolved QC result for current submission
   * - qcStatusMarkup: The built status markup
   * - checklistMarkup: The built folder checklist HTML
   * - hasFolder: boolean if folder is selected
   * - missingFolders: array of missing top level folders
   * - escapeHtml: html escaping function
   * - buildStructureGateMessage: function
   * - buildMissingRequiredFolderGuidance: function
   * - buildRemediationMarkup: function
   */
  function renderIntakeStep(props) {
    var state = props.state;
    var qcResult = props.qcResult;
    var qcStatusMarkup = props.qcStatusMarkup;
    var checklistMarkup = props.checklistMarkup;
    var hasFolder = props.hasFolder;
    var missingFolders = props.missingFolders;
    var escapeHtml = props.escapeHtml;
    var buildStructureGateMessage = props.buildStructureGateMessage;
    var buildMissingRequiredFolderGuidance = props.buildMissingRequiredFolderGuidance;
    var buildRemediationMarkup = props.buildRemediationMarkup;

    var folderInfo = hasFolder
      ? (
        '<p class="text-sm text-brand-text-strong mt-2 break-all">' + escapeHtml(state.selectedFolder.path) + '</p>' +
        '<p class="text-xs text-brand-text mt-1">' + state.selectedFolder.fileCount + ' files detected</p>'
      )
      : '<p class="text-sm text-brand-text mt-2">No pack folder selected yet.</p>';
      
    var structureWarning = missingFolders.length
      ? '<p id="workspace-missing-folders" class="auth-feedback warning mt-3">' + escapeHtml(buildStructureGateMessage(missingFolders)) + '</p>'
      : (hasFolder ? '<p id="workspace-missing-folders" class="text-sm text-green-700 mt-3">✓ ' + escapeHtml(buildStructureGateMessage([])) + '</p>' : '');
      
    var structureGuidance = missingFolders.length
      ? '<p id="workspace-folder-guidance" class="text-sm text-brand-text mt-1">' + escapeHtml(buildMissingRequiredFolderGuidance(missingFolders)) + '</p>'
      : '';

    return (
      '<div class="space-y-6">' +
      // Pack folder section — compact
      '<div>' +
      '<div class="flex items-center justify-between mb-2">' +
      '<h4 class="text-base font-semibold text-brand-text-strong">Pack Folder</h4>' +
      '<button type="button" id="workspace-select-pack-folder" class="auth-button-secondary text-xs px-3 py-1">Select Folder</button>' +
      '</div>' +
      (hasFolder
        ? '<p class="text-xs text-brand-text break-all mb-2">' + escapeHtml(state.selectedFolder.path) + ' &middot; ' + state.selectedFolder.fileCount + ' files</p>'
        : '<p class="text-xs text-brand-text mb-2">No folder selected yet.</p>') +
      structureWarning +
      structureGuidance +
      checklistMarkup +
      '</div>' +
      // QC section (divider)
      '<div class="border-t border-brand-border pt-5">' +
      '<h4 class="text-base font-semibold text-brand-text-strong mb-1">QC Remediation</h4>' +
      '<p class="text-sm text-brand-text mb-4">Run QC to check your pack files. Resolve all blocking findings before submitting.</p>' +
      '<button type="button" id="workspace-run-qc" class="auth-button" ' +
      (state.isQcRunning ? 'disabled aria-disabled="true"' : '') + '>' +
      (state.isQcRunning ? '⟳ QC Running...' : 'Run QC') +
      '</button>' +
      qcStatusMarkup +
      '<div class="rounded-lg border border-brand-border bg-brand-surface-alt p-5 mt-4">' +
      buildRemediationMarkup(qcResult) +
      '</div>' +
      '</div>' +
      // Nav buttons
      '<div class="flex items-center justify-between pt-2">' +
      '<button type="button" id="wizard-prev-btn" class="auth-button-secondary" data-wizard-step="airtable">← Back</button>' +
      '<button type="button" id="wizard-next-btn" class="auth-button" data-wizard-next="review">Next: Review &amp; Submit →</button>' +
      '</div>' +
      '</div>'
    );
  }

  return {
    renderIntakeStep: renderIntakeStep
  };
});
