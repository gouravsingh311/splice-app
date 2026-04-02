(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceHistoryPanel = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  var sd = globalThis.workspaceSubmissionDetail;
  if (!sd && typeof require === 'function') {
    try { sd = require('./submission-detail.js'); } catch (e) {}
  }
  sd = sd || {};
  var resolveNeedsActionDescriptor = sd.resolveNeedsActionDescriptor || function () { return { needsAction: false, kind: 'none', label: '' }; };
  var buildNeedsActionBadge = sd.buildNeedsActionBadge || function () { return ''; };
  var statusChip = sd.statusChip || function (status) {
    var safe = String(status || 'draft').toLowerCase();
    var cls = safe === 'under_review' ? 'under-review' : safe;
    return '<span class="fe-status-chip ' + cls + '">' + safe.replace('_', ' ') + '</span>';
  };

  function humanizeUploadStatus(status) {
    switch (String(status || '').trim().toLowerCase()) {
      case 'queued':
        return 'Upload queued in the background';
      case 'in_progress':
        return 'Uploading files to Dropbox';
      case 'paused':
        return 'Upload paused';
      case 'completed':
        return 'Upload complete';
      case 'failed':
        return 'Upload failed';
      case 'canceled':
        return 'Upload canceled';
      default:
        return 'Preparing upload';
    }
  }

  function buildUploadProgressMarkup(submission, escapeHtml) {
    if (!submission) {
      return '';
    }

    var uploadStatus = String(submission.uploadStatus || '').trim().toLowerCase();
    if (!uploadStatus && String(submission.currentState || '').toLowerCase() !== 'uploading') {
      return '';
    }

    var progress = Number.isInteger(submission.uploadProgressPercent)
      ? submission.uploadProgressPercent
      : 0;
    var statusText = humanizeUploadStatus(submission.uploadStatus);

    return (
      '<div class="mt-3 rounded-lg border border-brand-border bg-brand-bg p-3">' +
      '<progress class="w-full" max="100" value="' + progress + '"></progress>' +
      '<div class="mt-2 flex items-center justify-between gap-2">' +
      '<p class="text-xs text-brand-text">' + escapeHtml(statusText) + '</p>' +
      '<p class="text-xs font-semibold text-brand-text-strong">' + progress + '%</p>' +
      '</div>' +
      '</div>'
    );
  }

  /**
   * Renders the main-panel history list (cards layout)
   * @param {Object} props
   * - submissions: array
   * - timelinesBySubmissionId: map
   * - escapeHtml: function
   */
  function renderHistory(props) {
    var submissions = props.submissions;
    var timelinesBySubmissionId = props.timelinesBySubmissionId;
    var escapeHtml = props.escapeHtml;

    var historyInner = '';
    if (!submissions.length) {
      historyInner = '<p class="auth-subtle py-8 text-center">No submissions yet.<br/>Click <strong>New Draft</strong> to get started.</p>';
    } else {
      var needsActionCount = submissions.filter(function (s) {
        return resolveNeedsActionDescriptor(s, timelinesBySubmissionId[s.submissionId] || []).needsAction;
      }).length;
      var needsActionBanner = needsActionCount > 0
        ? ('<div class="mb-4 rounded-lg border border-brand-danger bg-brand-bg px-5 py-4">' +
           '<p class="text-xs font-semibold uppercase tracking-wide text-brand-danger">Needs Action</p>' +
           '<p class="text-sm text-brand-text mt-1">' + needsActionCount + ' submission' + (needsActionCount === 1 ? '' : 's') + ' require attention.</p>' +
           '<button type="button" class="auth-button-secondary text-xs px-3 py-1 mt-2" data-workspace-open-needs-action>Open Needs Action</button>' +
           '</div>')
        : '';
      historyInner = needsActionBanner + submissions.map(function (submission) {
        var title = submission.packName || submission.submissionId;
        var descriptor = resolveNeedsActionDescriptor(submission, timelinesBySubmissionId[submission.submissionId] || []);
        return (
          '<button class="w-full text-left px-5 py-4 border-b border-brand-border last:border-b-0 hover:bg-brand-surface-alt transition-colors duration-150"' +
          ' type="button" data-workspace-open="' + submission.submissionId + '">' +
          '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0">' +
          '<p class="text-sm font-semibold text-brand-text-strong truncate">' + escapeHtml(title) + '</p>' +
          '<p class="text-xs text-brand-text mt-0.5">Updated ' + submission.updatedAt.slice(0, 10) + '</p>' +
          buildUploadProgressMarkup(submission, escapeHtml) +
          '</div>' +
          '<div class="flex flex-col items-end gap-1 shrink-0">' +
          statusChip(submission.currentState) +
          buildNeedsActionBadge(descriptor) +
          '</div>' +
          '</div>' +
          '</button>'
        );
      }).join('');
    }
    return (
      '<div class="fe-card overflow-hidden p-0">' +
      '<div class="flex items-center justify-between px-5 py-4 border-b border-brand-border">' +
      '<h3 class="fe-card-title">Submission History</h3>' +
      '</div>' +
      '<div class="divide-y divide-brand-border">' + historyInner + '</div>' +
      '</div>'
    );
  }

  /**
   * Renders the sidebar submission list (inline into an existing DOM element)
   * @param {Object} props
   * - submissions: array
   * - timelinesBySubmissionId: map
   * - escapeHtml: function
   */
  function renderSidebarList(props) {
    var submissions = props.submissions;
    var timelinesBySubmissionId = props.timelinesBySubmissionId;
    var escapeHtml = props.escapeHtml;

    if (!submissions.length) {
      return '<p class="auth-subtle py-4 text-center">No submissions yet.<br/>Click <strong>New Draft</strong> to get started.</p>';
    }

    var needsActionCount = submissions.filter(function (submission) {
      return resolveNeedsActionDescriptor(submission, timelinesBySubmissionId[submission.submissionId] || []).needsAction;
    }).length;
    var needsActionSummary = needsActionCount > 0
      ? (
        '<div class="mb-4 rounded-brand-sm border border-brand-danger bg-brand-bg p-3">' +
        '<p class="text-xs font-semibold uppercase tracking-wide text-brand-danger">Needs Action</p>' +
        '<p class="text-sm text-brand-text mt-1">' + needsActionCount + ' submission' + (needsActionCount === 1 ? '' : 's') + ' require attention.</p>' +
        '<button type="button" class="auth-button-secondary text-xs px-3 py-1 mt-2" data-workspace-open-needs-action>Open Needs Action</button>' +
        '</div>'
      )
      : '';

    return needsActionSummary + submissions.map(function (submission) {
      var title = submission.packName || submission.submissionId;
      var descriptor = resolveNeedsActionDescriptor(submission, timelinesBySubmissionId[submission.submissionId] || []);
      return (
        '<button class="w-full text-left px-5 py-4 border-b border-brand-border last:border-b-0 hover:bg-brand-surface-alt transition-colors duration-150"' +
        ' type="button" data-workspace-open="' + submission.submissionId + '">' +
        '<div class="flex items-start justify-between gap-3">' +
        '<div class="min-w-0">' +
        '<p class="text-sm font-semibold text-brand-text-strong truncate">' + escapeHtml(title) + '</p>' +
        '<p class="text-xs text-brand-text mt-0.5">Updated ' + submission.updatedAt.slice(0, 10) + '</p>' +
        buildUploadProgressMarkup(submission, escapeHtml) +
        '</div>' +
        '<div class="flex flex-col items-end gap-1 shrink-0">' +
        statusChip(submission.currentState) +
        buildNeedsActionBadge(descriptor) +
        '</div>' +
        '</div>' +
        '</button>'
      );
    }).join('');
  }

  return {
    renderHistory: renderHistory,
    renderSidebarList: renderSidebarList
  };
});
