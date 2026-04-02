(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceWizardNav = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  var stepCssByStatus = {
    done: 'bg-green-50 border-green-600 text-green-800',
    active: 'bg-brand-surface-alt border-brand-accent text-brand-text-strong',
    viewing: 'bg-brand-surface-alt border-brand-accent text-brand-text-strong ring-2 ring-brand-accent ring-offset-1',
    pending: 'bg-brand-bg border-brand-border text-brand-text',
  };

  /**
   * @param {Array} stepStates - Array of { id, status }
   * @param {string} uiViewStep - The currently viewed step ID
   * @param {Object} stepLabels - Map of stepId to human-readable label
   * @param {Function} escapeHtml - function to escape HTML
   */
  function renderWizardNav(stepStates, uiViewStep, stepLabels, escapeHtml) {
    return stepStates.map(function (step, index) {
      var status = step.status || 'pending';
      var isViewing = step.id === uiViewStep;
      var css = isViewing ? stepCssByStatus.viewing : (stepCssByStatus[status] || stepCssByStatus.pending);
      var label = stepLabels[step.id] || step.id;
      var statusIcon = status === 'done' ? ' ✓' : '';
      return (
        '<button type="button" data-wizard-step="' + step.id + '"' +
        ' class="w-full text-left rounded-lg border-2 px-4 py-3 transition-all duration-150 ' + css + '"' +
        ' aria-current="' + (isViewing ? 'step' : 'false') + '">' +
        '<p class="text-xs font-semibold uppercase tracking-wider opacity-70">Step ' + (index + 1) + statusIcon + '</p>' +
        '<p class="text-sm font-bold mt-0.5">' + escapeHtml(label) + '</p>' +
        '</button>'
      );
    }).join('');
  }

  return {
    renderWizardNav: renderWizardNav
  };
});
