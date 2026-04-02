(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceMarkup = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  var q = globalThis.workspaceQcFindings;
  if (!q && typeof require === 'function') {
    try { q = require('./qc-findings.js'); } catch (e) {}
  }
  q = q || {};
  var normalizeQcFindings = q.normalizeQcFindings || function (f) { return Array.isArray(f) ? f : []; };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildSubmitBlockedFeedbackMessage(readiness) {
    var blockers = readiness && Array.isArray(readiness.blockers) ? readiness.blockers : [];
    if (blockers.length === 0) {
      return 'Ready to submit for review. Next step: click Submit for Review.';
    }
    if (blockers.length === 1) {
      return blockers[0].message + ' ' + blockers[0].nextAction;
    }
    return (
      'Submit is blocked: ' +
      blockers.map(function (blocker) { return blocker.title; }).join(' | ') +
      '. Next step: complete the blocker list below, then submit again.'
    );
  }

  function buildReadinessSummaryText(readiness) {
    if (readiness && readiness.canSubmit) {
      return 'All checks passed. Next step: click Submit for Review.';
    }
    var blockers = readiness && readiness.blockers ? readiness.blockers.length : 0;
    return (
      'Submit is blocked by ' + blockers + ' requirement' + (blockers === 1 ? '' : 's') +
      '. Next step: complete each blocker shown below.'
    );
  }

  function buildReadinessBlockersMarkup(readiness) {
    if (readiness.canSubmit) {
      return '<p class="auth-subtle mt-2">Next action: click Submit for Review.</p>';
    }
    return (
      '<ol id="workspace-readiness-blockers" class="mt-3 space-y-2">' +
      readiness.blockers.map(function (blocker) {
        return (
          '<li class="p-3 rounded-brand-sm border border-brand-border bg-brand-bg">' +
          '<p class="text-sm font-semibold text-brand-text-strong">' + escapeHtml(blocker.title) + '</p>' +
          '<p class="text-sm text-brand-text mt-1">' + escapeHtml(blocker.message) + '</p>' +
          '<p class="text-xs text-brand-text mt-1">Next action: ' + escapeHtml(blocker.nextAction) + '</p>' +
          '</li>'
        );
      }).join('') +
      '</ol>'
    );
  }

  function buildCreatorRemediationItems(findings) {
    var results = normalizeQcFindings(findings);
    return results.map(function (finding) {
      return {
        severity: finding.severity,
        ruleId: finding.ruleId,
        title: finding.message,
        fileRef: finding.fileRef,
        remediation: finding.remediation,
        nextAction: finding.severity === 'blocking'
          ? 'Fix this issue, then run QC again.'
          : 'Recommended: fix this warning before submitting.',
      };
    });
  }

  function buildRemediationSummaryText(items) {
    var blockingCount = items.filter(function (item) { return item.severity === 'blocking'; }).length;
    var warningCount = items.length - blockingCount;
    if (items.length === 0) {
      return 'No findings yet. Run QC to generate remediation guidance.';
    }
    if (blockingCount === 0) {
      return 'No blocking findings. ' + warningCount + ' warning' + (warningCount === 1 ? '' : 's') + ' remain.';
    }
    return blockingCount + ' blocking finding' + (blockingCount === 1 ? '' : 's') + ' and ' +
      warningCount + ' warning' + (warningCount === 1 ? '' : 's') + ' found.';
  }

  function buildRemediationMarkup(qcResult) {
    if (!qcResult) {
      return '<p class="auth-subtle mt-2">Run QC to get file-level remediation and next actions.</p>';
    }
    var items = buildCreatorRemediationItems(qcResult.findings || []);
    var summary = buildRemediationSummaryText(items);
    var hasBlocking = items.some(function (item) { return item.severity === 'blocking'; });
    if (items.length === 0) {
      return '<p class="auth-feedback mt-2">' + escapeHtml(summary) + '</p>';
    }
    return (
      '<p class="auth-feedback ' + (hasBlocking ? 'warning' : '') + ' mt-2">' + escapeHtml(summary) + '</p>' +
      '<ol id="workspace-remediation-items" tabindex="0" aria-label="QC remediation findings list" class="mt-3 space-y-2 max-h-96 overflow-y-auto pr-1">' +
      items.map(function (item) {
        return (
          '<li class="p-3 rounded-brand-sm border border-brand-border bg-brand-bg">' +
          '<p class="text-xs uppercase tracking-wide ' +
          (item.severity === 'blocking' ? 'text-brand-danger' : 'text-brand-text') +
          '">' + escapeHtml(item.severity) + ' | ' + escapeHtml(item.ruleId) + '</p>' +
          '<p class="text-sm text-brand-text-strong mt-1">' + escapeHtml(item.title) + '</p>' +
          (item.fileRef ? '<p class="text-xs text-brand-text mt-1">File: ' + escapeHtml(item.fileRef) + '</p>' : '') +
          '<p class="text-sm text-brand-text mt-1">How to fix: ' + escapeHtml(item.remediation) + '</p>' +
          '<p class="text-xs text-brand-text mt-1">Next action: ' + escapeHtml(item.nextAction) + '</p>' +
          '</li>'
        );
      }).join('') +
      '</ol>'
    );
  }

  function buildQcRunStatusMarkup(qcRunStatus) {
    if (!qcRunStatus || !qcRunStatus.tone || !qcRunStatus.message) {
      return '';
    }
    var tone = String(qcRunStatus.tone).toLowerCase();
    var isRunning = tone === 'running';
    var statusClass = isRunning ? 'auth-feedback' : ('auth-feedback ' + (tone === 'error' ? 'warning' : ''));
    return (
      '<p id="workspace-qc-run-status" class="' + statusClass + ' mt-3" aria-live="polite" aria-atomic="true" role="status">' +
      (isRunning
        ? '<span aria-hidden="true" class="inline-block mr-2 h-3 w-3 animate-spin rounded-full border-2 border-brand-border border-t-brand-accent"></span>'
        : '') +
      escapeHtml(String(qcRunStatus.message)) +
      '</p>'
    );
  }

  return {
    escapeHtml: escapeHtml,
    buildSubmitBlockedFeedbackMessage: buildSubmitBlockedFeedbackMessage,
    buildReadinessSummaryText: buildReadinessSummaryText,
    buildReadinessBlockersMarkup: buildReadinessBlockersMarkup,
    buildCreatorRemediationItems: buildCreatorRemediationItems,
    buildRemediationSummaryText: buildRemediationSummaryText,
    buildRemediationMarkup: buildRemediationMarkup,
    buildQcRunStatusMarkup: buildQcRunStatusMarkup
  };
});
