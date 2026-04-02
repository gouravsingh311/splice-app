(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceAirtableStep = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /**
   * @param {Object} props
   * - state: The full workspace state
   * - draft: The active drafting state
   * - workflowContext: Resolved workflow blockers context
   * - escapeHtml: html escaping function
   * - buildReleaseMonthOptions: function to build <option> markup
   */
  function renderAirtableStep(props) {
    var state = props.state;
    var draft = props.draft;
    var workflowContext = props.workflowContext;
    var escapeHtml = props.escapeHtml;
    var buildReleaseMonthOptions = props.buildReleaseMonthOptions;

    var airtableLinkStatus = String(state.airtable.syncStatus || '').toLowerCase();
    var airtableStatusText = 'Enter your metadata above, then click Sync Airtable Details.';
    if (workflowContext.airtableFormCompleted) {
      if (!workflowContext.airtableLinkedKnown) {
        airtableStatusText = 'Details saved — click Sync Airtable Details again to confirm the link.';
      } else if (airtableLinkStatus === 'linked') {
        airtableStatusText = '✓ Airtable linked and confirmed for this submission.';
      } else if (airtableLinkStatus === 'missing') {
        airtableStatusText = 'No Airtable record matched. Review your details, then sync again.';
      } else if (airtableLinkStatus === 'duplicate') {
        airtableStatusText = 'Multiple Airtable records matched. Fix the duplicate in Airtable, then sync again.';
      } else if (airtableLinkStatus === 'error') {
        airtableStatusText = 'Sync did not finish. Check your details, then try again.';
      } else {
        airtableStatusText = 'Details saved but not yet linked. Click Sync Airtable Details.';
      }
    }
    
    var airtableErrorCode = String(state.airtable.lastErrorCode || '').toUpperCase();
    var airtableErrorDetail = String(state.airtable.lastErrorDetail || '');
    var airtableErrorFriendly = '';
    
    if (airtableErrorCode === 'AIRTABLE_UNAVAILABLE') {
      airtableErrorFriendly = 'Airtable is currently unavailable (API error). You can proceed to step 2 and retry syncing later before submitting.';
    } else if (airtableErrorCode === 'AIRTABLE_NOT_FOUND') {
      airtableErrorFriendly = 'No matching Airtable record found. Check your pack name and label, then sync again.';
    } else if (airtableErrorCode === 'AIRTABLE_DUPLICATE') {
      airtableErrorFriendly = 'Multiple Airtable records matched. Fix the duplicate in Airtable, then sync again.';
    } else if (airtableErrorCode || airtableErrorDetail) {
      airtableErrorFriendly = [airtableErrorCode, airtableErrorDetail].filter(Boolean).join(': ');
    }
    
    var airtableErrorMarkup = airtableErrorFriendly
      ? '<p id="workspace-airtable-error" class="text-xs text-brand-text mt-3 italic">' +
        escapeHtml(airtableErrorFriendly) +
        '</p>'
      : '';

    var airtableMeta = [];
    if (state.airtable.recordId) { airtableMeta.push('Record ' + escapeHtml(state.airtable.recordId)); }
    if (state.airtable.lastSyncedAt) { airtableMeta.push('Synced ' + escapeHtml(String(state.airtable.lastSyncedAt).slice(0, 19).replace('T', ' '))); }

    return (
      '<div class="space-y-6">' +
      '<div>' +
      '<h4 class="text-base font-semibold text-brand-text-strong mb-1">Pack Metadata</h4>' +
      '<p class="text-sm text-brand-text mb-4">Fill in the details about your pack before syncing to Airtable.</p>' +
      '<div class="grid gap-4 md:grid-cols-2">' +
      '<div><label class="fe-label" for="workspace-pack-name">Pack Name</label>' +
      '<input id="workspace-pack-name" class="auth-input" value="' + escapeHtml(draft.packName || '') + '" /></div>' +
      '<div><label class="fe-label" for="workspace-label-name">Label Name</label>' +
      '<input id="workspace-label-name" class="auth-input" value="' + escapeHtml(draft.labelName || '') + '" /></div>' +
      '<div><label class="fe-label" for="workspace-release-month">Release Month</label>' +
      '<select id="workspace-release-month" class="auth-input">' +
      '<option value="">Select month</option>' +
      buildReleaseMonthOptions(draft.releaseMonth) +
      '</select></div>' +
      '<div><label class="fe-label" for="workspace-tags">Tags <span class="fe-label-hint">comma-separated</span></label>' +
      '<input id="workspace-tags" class="auth-input" value="' + escapeHtml((draft.tags || []).join(', ')) + '" /></div>' +
      '<div class="md:col-span-2"><label class="fe-label" for="workspace-notes">Notes</label>' +
      '<textarea id="workspace-notes" class="auth-input min-h-28">' + escapeHtml(draft.notes || '') + '</textarea></div>' +
      '</div>' +
      '</div>' +
      '<div class="rounded-lg border border-brand-border bg-brand-surface-alt p-5">' +
      '<h4 class="text-sm font-semibold text-brand-text-strong mb-2">Airtable Sync</h4>' +
      '<p id="workspace-airtable-status" class="text-sm ' + (workflowContext.airtableLinked ? 'text-green-700' : 'text-brand-text') + ' mb-3" aria-live="polite" aria-atomic="true">' +
      escapeHtml(airtableStatusText) + '</p>' +
      (airtableMeta.length ? '<p class="text-xs text-brand-text mb-3">' + airtableMeta.join(' · ') + '</p>' : '') +
      airtableErrorMarkup +
      '<div class="flex flex-wrap gap-3 mt-1">' +
      '<button type="button" id="workspace-airtable-complete" class="auth-button-secondary">Sync Airtable Details</button>' +
      '<button type="button" id="workspace-airtable-reset" class="auth-button-secondary">Reset Airtable Step</button>' +
      '</div>' +
      (state.airtable.recordUrl ? '<p class="text-xs text-brand-text mt-3 break-all">Record: ' + escapeHtml(state.airtable.recordUrl) + '</p>' : '') +
      '</div>' +
      '<div class="flex items-center justify-between pt-2">' +
      '<button type="button" id="workspace-save-metadata" class="auth-button-secondary">Save Metadata</button>' +
      '<button type="button" id="wizard-next-btn" class="auth-button" data-wizard-next="intake">Next: Pack Intake &amp; QC →</button>' +
      '</div>' +
      '</div>'
    );
  }

  return {
    renderAirtableStep: renderAirtableStep
  };
});
