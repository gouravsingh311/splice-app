(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceSubmissionDetail = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function statusChip(status) {
    var safe = String(status || 'draft').toLowerCase();
    var cls = safe === 'under_review' ? 'under-review' : safe;
    return '<span class="fe-status-chip ' + cls + '">' + safe.replace('_', ' ') + '</span>';
  }

  function hasDraftAfterRejectedLifecycleEvent(timeline) {
    var i;
    var seenRejected = false;
    if (!Array.isArray(timeline)) { return false; }
    for (i = 0; i < timeline.length; i += 1) {
      var toState = String(timeline[i] && timeline[i].toState ? timeline[i].toState : '').toLowerCase();
      if (toState === 'rejected') { seenRejected = true; }
      if (seenRejected && toState === 'draft') { return true; }
    }
    return false;
  }

  function resolveNeedsActionDescriptor(submission, timeline) {
    var currentState = String(submission && submission.currentState ? submission.currentState : '').toLowerCase();
    if (currentState === 'rejected') {
      return { needsAction: true, kind: 'rejected', label: 'Needs Action' };
    }
    if (currentState === 'draft' && hasDraftAfterRejectedLifecycleEvent(timeline)) {
      return { needsAction: true, kind: 'reopened', label: 'Needs Action' };
    }
    return { needsAction: false, kind: 'none', label: '' };
  }

  function buildNeedsActionBadge(descriptor) {
    if (!descriptor || descriptor.needsAction !== true) { return ''; }
    return '<span class="ml-2 inline-flex items-center rounded-full border border-brand-danger px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-danger">Needs Action</span>';
  }

  function resolveLifecycleVisibility(submission, timeline) {
    var currentState = String(submission && submission.currentState ? submission.currentState : '').toLowerCase();
    var needsAction = resolveNeedsActionDescriptor(submission, timeline);

    if (needsAction.kind === 'rejected') {
      return {
        toneClass: 'auth-feedback warning',
        heading: 'Rejected: waiting for reviewer/admin reopen',
        message: 'Reviewer/Admin must click Re-open first. Next step: wait for state to return to draft; then continue this submission, update files/metadata, run QC if needed, and submit again.',
        showEditAction: false,
        actionLabel: '',
      };
    }
    if (needsAction.kind === 'reopened') {
      return {
        toneClass: 'auth-feedback success',
        heading: 'Reopened for amendment',
        message: 'This submission is reopened and editable. Next step: continue metadata, intake, QC remediation, then resubmit from this workflow.',
        showEditAction: true,
        actionLabel: 'Continue Reopened Draft',
      };
    }
    if (currentState === 'draft') {
      return {
        toneClass: 'auth-subtle',
        heading: 'Draft in progress',
        message: 'Next step: continue preparing this draft inside submissions.',
        showEditAction: true,
        actionLabel: 'Continue Draft',
      };
    }
    if (currentState === 'under_review') {
      return {
        toneClass: 'auth-subtle',
        heading: 'Under review',
        message: 'Reviewer decisions and lifecycle changes will appear in this timeline. Next step: monitor this submission until a decision is posted.',
        showEditAction: false,
        actionLabel: '',
      };
    }
    return {
      toneClass: 'auth-subtle',
      heading: 'Lifecycle status',
      message: 'Status history and detail stay consolidated in submissions. Next step: review the latest timeline event and follow the linked workflow action.',
      showEditAction: false,
      actionLabel: '',
    };
  }

  function findLatestRejectedTimelineItem(selectedTimeline) {
    var i;
    if (!Array.isArray(selectedTimeline)) { return null; }
    for (i = 0; i < selectedTimeline.length; i += 1) {
      if (String(selectedTimeline[i] && selectedTimeline[i].toState ? selectedTimeline[i].toState : '').toLowerCase() === 'rejected') {
        return selectedTimeline[i];
      }
    }
    return null;
  }

  function humanizeCode(raw) {
    return String(raw || '')
      .trim()
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b([a-z])/g, function (m, c) { return c.toUpperCase(); });
  }

  /**
   * @param {Object} props
   * - submission: The submission object (or null)
   * - selectedTimeline: Timeline events array
   * - escapeHtml: function
   */
  function renderSubmissionDetail(props) {
    var submission = props.submission;
    var selectedTimeline = props.selectedTimeline;
    var escapeHtml = props.escapeHtml;

    if (!submission) {
      return '<div class="fe-card"><p class="auth-subtle">Select a submission from history.</p></div>';
    }

    var lifecycle = resolveLifecycleVisibility(submission, selectedTimeline);
    var needsActionBadge = buildNeedsActionBadge(resolveNeedsActionDescriptor(submission, selectedTimeline));
    var rejectedTimelineItem = findLatestRejectedTimelineItem(selectedTimeline);
    var rejectedReasonCode = rejectedTimelineItem && rejectedTimelineItem.reviewReasonCode
      ? humanizeCode(rejectedTimelineItem.reviewReasonCode)
      : (rejectedTimelineItem && rejectedTimelineItem.reason ? humanizeCode(rejectedTimelineItem.reason) : '');
    var rejectedNotes = rejectedTimelineItem && rejectedTimelineItem.reviewNotes ? rejectedTimelineItem.reviewNotes : '';

    var timelineHtml;
    if (!selectedTimeline.length) {
      timelineHtml = '<li class="fe-timeline-item"><span class="fe-timeline-dot"></span><p class="fe-timeline-text">No transition events yet.</p></li>';
    } else {
      timelineHtml = selectedTimeline.map(function (item) {
        return (
          '<li class="fe-timeline-item">' +
          '<span class="fe-timeline-dot"></span>' +
          '<p class="fe-timeline-text">' + escapeHtml(item.toState.replace('_', ' ')) +
          (item.reason ? ' - ' + escapeHtml(item.reason) : '') +
          (item.reviewReasonCode ? ' [' + escapeHtml(item.reviewReasonCode) + ']' : '') +
          (item.reviewNotes ? ' - ' + escapeHtml(item.reviewNotes) : '') + '</p>' +
          '<p class="fe-timeline-date">' + item.createdAt.slice(0, 19).replace('T', ' ') + '</p>' +
          '</li>'
        );
      }).join('');
    }

    var rejectionDetailsHtml = '';
    if (String(submission.currentState || '').toLowerCase() === 'rejected') {
      rejectionDetailsHtml =
        '<div class="mb-5 rounded-lg border border-brand-border p-4">' +
        '<h4 class="text-sm font-semibold uppercase tracking-wide text-brand-text-muted">Latest Rejection Detail</h4>' +
        '<p class="mt-2 text-sm"><span class="font-semibold">Reason:</span> ' + escapeHtml(rejectedReasonCode || 'Not provided') + '</p>' +
        '<p class="mt-1 text-sm"><span class="font-semibold">Reviewer Notes:</span> ' + escapeHtml(rejectedNotes || 'No reviewer notes were provided.') + '</p>' +
        '</div>';
    }

    var detailAction = lifecycle.showEditAction
      ? (
        '<div class="mt-5">' +
        '<button type="button" id="workspace-reopen-edit" class="auth-button-secondary">' + lifecycle.actionLabel + '</button>' +
        '</div>'
      )
      : '';

    return (
      '<div class="space-y-6">' +
      '<button type="button" id="workspace-back-to-list" class="flex items-center gap-1.5 text-sm text-brand-text hover:text-brand-text-strong transition-colors">' +
      '<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4" aria-hidden="true"><path fill-rule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clip-rule="evenodd"/></svg>' +
      'Back to Submissions' +
      '</button>' +
      '<div class="fe-card">' +
      '<div class="flex items-center justify-between mb-5">' +
      '<h3 class="fe-card-title">' + escapeHtml(submission.packName || 'Submission') + '</h3>' +
      '<span class="flex items-center gap-2">' + statusChip(submission.currentState) + needsActionBadge + '</span>' +
      '</div>' +
      '<div id="workspace-lifecycle-banner" tabindex="-1" class="' + lifecycle.toneClass + ' mb-5">' +
      '<p class="font-medium">' + escapeHtml(lifecycle.heading) + '</p>' +
      '<p class="mt-1">' + escapeHtml(lifecycle.message) + '</p>' +
      '</div>' +
      rejectionDetailsHtml +
      '<dl class="fe-dl">' +
      '<dt class="fe-dt">Submission ID</dt><dd class="fe-dd">' + escapeHtml(submission.submissionId) + '</dd>' +
      '<dt class="fe-dt">Pack Name</dt><dd class="fe-dd">' + escapeHtml(submission.packName || '-') + '</dd>' +
      '<dt class="fe-dt">Release Month</dt><dd class="fe-dd">' + escapeHtml(submission.releaseMonth || '-') + '</dd>' +
      '<dt class="fe-dt">Notes</dt><dd class="fe-dd">' + escapeHtml(submission.notes || '-') + '</dd>' +
      '<dt class="fe-dt">Updated</dt><dd class="fe-dd">' + escapeHtml(submission.updatedAt.slice(0, 19).replace('T', ' ')) + '</dd>' +
      '</dl>' +
      detailAction +
      '</div>' +
      '<div class="fe-card">' +
      '<h3 class="fe-card-title mb-4">Timeline</h3>' +
      '<ol class="fe-timeline">' + timelineHtml + '</ol>' +
      '</div>' +
      '</div>'
    );
  }

  return {
    statusChip: statusChip,
    resolveNeedsActionDescriptor: resolveNeedsActionDescriptor,
    buildNeedsActionBadge: buildNeedsActionBadge,
    resolveLifecycleVisibility: resolveLifecycleVisibility,
    renderSubmissionDetail: renderSubmissionDetail
  };
});
