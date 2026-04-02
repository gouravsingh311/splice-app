(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceReviewStep = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /**
   * @param {Object} props
   * - state: The full workspace state
   * - canSubmit: resolved submit readiness
   * - readiness: Canonical readiness object
   * - escapeHtml: html escaping function
   * - buildReadinessSummaryText: function
   * - buildReadinessBlockersMarkup: function
   */
  function renderReviewStep(props) {
    var state = props.state;
    var canSubmit = props.canSubmit;
    var readiness = props.readiness;
    var uploadState = props.uploadState;
    var escapeHtml = props.escapeHtml;
    var buildReadinessSummaryText = props.buildReadinessSummaryText;
    var buildReadinessBlockersMarkup = props.buildReadinessBlockersMarkup;

    var readinessSummary = buildReadinessSummaryText(readiness);
    var uploadStatusForDisplay = uploadState ? String(uploadState.status || '').trim().toLowerCase() : '';
    var showUploadProgress = Boolean(
      uploadState &&
      uploadState.submissionId === state.draft.submissionId &&
      (uploadStatusForDisplay === 'queued' ||
        uploadStatusForDisplay === 'in_progress' ||
        uploadStatusForDisplay === 'paused' ||
        uploadStatusForDisplay === 'failed')
    );
    var uploadStatus = showUploadProgress ? String(uploadState.status || '').trim().toLowerCase() : '';
    var uploadControlInFlight = String(state.uploadControlInFlight || '').trim().toLowerCase();
    var showPauseResumeControls = uploadStatus === 'queued' || uploadStatus === 'in_progress' || uploadStatus === 'paused' || uploadStatus === 'failed';
    var showResumeControl = uploadStatus === 'paused' || uploadStatus === 'failed';
    var showCancelControl = uploadStatus === 'queued' || uploadStatus === 'in_progress' || uploadStatus === 'paused';
    var primaryControlLabel = showResumeControl ? 'Resume Upload' : 'Pause Upload';
    var primaryControlAction = showResumeControl ? 'resume' : 'pause';
    var controlDisabled = uploadControlInFlight ? 'disabled' : '';
    var cancelDisabled = uploadControlInFlight ? 'disabled' : '';
    var uploadControlMarkup = showUploadProgress && showPauseResumeControls
      ? (
        '<div class="mt-4 flex flex-wrap gap-2">' +
        '<button type="button" class="auth-button-secondary text-xs px-3 py-1" data-upload-control="' + primaryControlAction + '" ' + controlDisabled + '>' +
        escapeHtml(primaryControlLabel) +
        '</button>' +
        (showCancelControl
          ? (
            '<button type="button" class="auth-button-secondary text-xs px-3 py-1 border-brand-danger text-brand-danger" data-upload-control="cancel" ' + cancelDisabled + '>' +
            'Cancel Upload' +
            '</button>'
          )
          : '') +
        '</div>' +
        '<p class="mt-2 text-xs text-brand-text">' +
        escapeHtml(
          uploadStatus === 'failed'
            ? 'The upload failed. Resume it explicitly to retry from where possible.'
            : (showResumeControl
              ? 'The upload is paused. Resume it or cancel the submission.'
              : 'You can pause this upload briefly or cancel it if you need to abort the handoff.')
        ) +
        '</p>'
      )
      : '';
    var uploadProgressMarkup = showUploadProgress
      ? (
        '<div class="rounded-lg border border-brand-border bg-brand-bg p-4">' +
        '<label class="fe-label">Upload Progress</label>' +
        '<progress id="workspace-upload-progress" class="w-full mt-2" max="100" value="' + uploadState.progressPercent + '"></progress>' +
        '<div class="mt-2 flex items-center justify-between gap-3">' +
        '<p class="text-sm text-brand-text" aria-live="polite" aria-atomic="true">' + escapeHtml(uploadState.statusText || 'Preparing upload') + '</p>' +
        '<p class="text-xs text-brand-text shrink-0">' + uploadState.progressPercent + '%</p>' +
        '</div>' +
        (uploadState.error
          ? '<p class="mt-2 text-sm text-brand-danger">' + escapeHtml(uploadState.error) + '</p>'
          : '') +
        uploadControlMarkup +
        '</div>'
      )
      : '';

    return (
      '<div class="space-y-6">' +
      '<div>' +
      '<h4 class="text-base font-semibold text-brand-text-strong mb-1">Submit for Review</h4>' +
      '<p class="text-sm text-brand-text mb-4">Review your submission readiness below, then submit when ready.</p>' +
      '</div>' +
      uploadProgressMarkup +
      '<div class="rounded-lg border border-brand-border bg-brand-surface-alt p-5">' +
      '<h5 class="text-sm font-semibold text-brand-text-strong mb-2">Readiness Check</h5>' +
      '<p id="workspace-readiness-summary" class="text-sm ' + (readiness.canSubmit ? 'text-green-700' : 'text-brand-text') + '" aria-live="polite" aria-atomic="true">' +
      escapeHtml(readinessSummary) + '</p>' +
      buildReadinessBlockersMarkup(readiness) +
      '</div>' +
      '<div class="flex items-center justify-between pt-2">' +
      '<button type="button" id="wizard-prev-btn" class="auth-button-secondary" data-wizard-step="qc">← Back</button>' +
      '<button type="button" id="workspace-submit-review" class="auth-button" ' +
      (canSubmit ? '' : 'disabled') + '>' +
      ((showUploadProgress && uploadStatus === 'paused')
        ? 'Upload Paused'
        : (state.isSubmitting && (uploadStatus === 'queued' || uploadStatus === 'in_progress') ? 'Uploading…' : 'Submit for Review')) +
      '</button>' +
      '</div>' +
      '</div>'
    );
  }

  return {
    renderReviewStep: renderReviewStep
  };
});
