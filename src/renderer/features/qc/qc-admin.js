(function(global) {
/* QC Admin Flows (PRD-06) — extracted from renderer.js */
/* globals qcState, appState, notificationState, api, toPrettyJson, getValue, setValue, getText, setText, setButtonBusy, setFeedback, getActiveActorRole */
function buildQcEvaluationPayload() {
  var folders = getValue('qc-folders').split(',').map(function (f) { return f.trim(); }).filter(Boolean);
  var submissionId = getValue('qc-submission-id') || qcState.activeSubmissionId || 'sub-local-1';
  var requestId = 'qc-' + Date.now();
  return {
    requestId: requestId,
    submissionId: submissionId,
    actorId: appState.actor.id || notificationState.actorId || 'desktop-local',
    actorRole: getActiveActorRole(),
    pack: {
      packName: getValue('qc-pack-name') || 'Label - Pack',
      declaredTopLevelFolders: folders.length > 0 ? folders : ['Artwork', 'Audio', 'Description'],
      audioZip: {
        filename: getValue('qc-audio-zip-name') || 'Label - Pack.zip',
        sizeBytes: parseInt(getValue('qc-audio-zip-size'), 10) || 0,
      },
      sampleCount: parseInt(getValue('qc-sample-count'), 10) || 0,
      containsUnsupportedNameTokens: getChecked('qc-unsupported-tokens'),
    },
  };
}

function logQcAdminError(scope, error) {
  var detail = error && error.message ? error.message : String(error || 'unknown error');
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[qc-admin] ' + scope + ' failed', detail);
  }
  return detail;
}

function getQcCatalogApi() {
  if (qcGuidanceCatalog && typeof qcGuidanceCatalog.resolveGuidance === 'function') {
    return qcGuidanceCatalog;
  }
  return {
    CATEGORY_ORDER: ['folder', 'audio-zip', 'samples', 'demo', 'description', 'artwork', 'presets', 'midi'],
    CATEGORY_LABELS: {
      'folder': 'Folder',
      'audio-zip': 'Audio ZIP',
      'samples': 'Samples',
      'demo': 'Demo',
      'description': 'Description',
      'artwork': 'Artwork',
      'presets': 'Presets',
      'midi': 'MIDI',
    },
    resolveGuidance: function (ruleId) {
      var normalized = String(ruleId || '').toUpperCase();
      return {
        title: normalized || 'Unknown QC Rule',
        description: 'This QC finding requires review.',
        remediation: 'Review this finding and rerun QC.',
        category: inferQcCategoryFromRuleId(normalized),
      };
    },
    formatTemplate: function (template) {
      return String(template || '');
    },
  };
}

function inferQcCategoryFromRuleId(ruleId) {
  var value = String(ruleId || '').toUpperCase();
  if (value.indexOf('AUDIO_ZIP') !== -1 || value.indexOf('PACK.AUDIO.ZIP') === 0) { return 'audio-zip'; }
  if (value.indexOf('SAMPLE') !== -1 || value.indexOf('PACK.SAMPLE') === 0 || value.indexOf('PACK.NAMING') === 0) { return 'samples'; }
  if (value.indexOf('DEMO') !== -1) { return 'demo'; }
  if (value.indexOf('DESCRIPTION') !== -1) { return 'description'; }
  if (value.indexOf('ART') !== -1 || value.indexOf('ARTWORK') !== -1) { return 'artwork'; }
  if (value.indexOf('PRESET') !== -1) { return 'presets'; }
  if (value.indexOf('MIDI') !== -1) { return 'midi'; }
  return 'folder';
}

function formatQcSize(bytes) {
  if (!Number.isFinite(bytes)) { return '—'; }
  if (bytes >= 1024 * 1024 * 1024) { return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'; }
  if (bytes >= 1024 * 1024) { return (bytes / (1024 * 1024)).toFixed(2) + ' MB'; }
  if (bytes >= 1024) { return (bytes / 1024).toFixed(2) + ' KB'; }
  return String(bytes) + ' B';
}

function extractFindingFileRef(finding) {
  if (finding.fileRef) { return finding.fileRef; }
  var context = finding.context || {};
  return (
    context.file_ref ||
    context.fileRef ||
    context.path ||
    context.file ||
    context.relative_path ||
    context.audio_zip_filename ||
    context.filename ||
    null
  );
}

function hydrateFinding(finding) {
  var catalog = getQcCatalogApi();
  var ruleId = finding.ruleId || finding.rule_id || 'UNKNOWN_RULE';
  var guidance = catalog.resolveGuidance(ruleId);
  var context = finding.context || {};
  var fileRef = extractFindingFileRef(finding);
  var formattedRemediation = guidance.remediation || finding.remediation || 'Fix this issue and rerun QC.';
  if (typeof catalog.formatTemplate === 'function') {
    formattedRemediation = catalog.formatTemplate(formattedRemediation, {
      size: formatQcSize(context.audio_zip_size_bytes || context.size_bytes || context.size),
      count: context.sample_count || context.count || '—',
      file_ref: fileRef || '—',
    });
  }
  return {
    findingId: finding.findingId || finding.finding_id || (ruleId + ':' + (fileRef || 'unknown')),
    ruleId: ruleId,
    severity: finding.blocking || finding.severity === 'blocking' ? 'blocking' : 'warning',
    category: finding.category || guidance.category || inferQcCategoryFromRuleId(ruleId),
    fileRef: fileRef,
    message: finding.message || guidance.description || 'QC issue found.',
    remediation: formattedRemediation,
    diffTag: finding.diffTag || finding.diff_tag || null,
  };
}

function mapResultsData(data, fallbackRunId, fallbackStatus, fallbackStartedAt, fallbackCompletedAt, fallbackFindings) {
  var findings = Array.isArray(data && data.findings) ? data.findings.map(hydrateFinding) : fallbackFindings.map(hydrateFinding);
  return {
    runId: (data && data.runId) || fallbackRunId,
    submissionId: (data && data.submissionId) || qcState.activeSubmissionId || null,
    status: (data && data.status) || fallbackStatus || 'failed',
    startedAt: (data && data.startedAt) || fallbackStartedAt || new Date().toISOString(),
    completedAt: (data && data.completedAt) || fallbackCompletedAt || new Date().toISOString(),
    generatedAt: (data && data.generatedAt) || (data && data.completedAt) || fallbackCompletedAt || new Date().toISOString(),
    ruleSetVersion: (data && data.ruleSetVersion) || null,
    policyVersion: (data && data.policyVersion) || null,
    findings: findings,
    resolvedFindings: [],
    resolvedCount: 0,
  };
}

function findingFingerprint(finding) {
  return [
    (finding.ruleId || '').toLowerCase(),
    (finding.fileRef || '').toLowerCase(),
    (finding.message || '').toLowerCase(),
  ].join('|');
}

function applyFindingDiff(currentRun, previousRun) {
  var prevMap = {};
  var currentMap = {};
  (previousRun && previousRun.findings ? previousRun.findings : []).forEach(function (finding) {
    prevMap[findingFingerprint(finding)] = finding;
  });
  (currentRun.findings || []).forEach(function (finding) {
    currentMap[findingFingerprint(finding)] = finding;
  });

  currentRun.findings = (currentRun.findings || []).map(function (finding) {
    var key = findingFingerprint(finding);
    return Object.assign({}, finding, {
      diffTag: prevMap[key] ? 'unchanged' : 'new',
    });
  });

  currentRun.resolvedFindings = Object.keys(prevMap)
    .filter(function (key) { return !currentMap[key]; })
    .map(function (key) {
      return Object.assign({}, prevMap[key], { diffTag: 'resolved' });
    });
  currentRun.resolvedCount = currentRun.resolvedFindings.length;
  return currentRun;
}

function compareFindingOrder(a, b) {
  if (a.severity !== b.severity) {
    return a.severity === 'blocking' ? -1 : 1;
  }
  if (a.ruleId !== b.ruleId) {
    return String(a.ruleId).localeCompare(String(b.ruleId));
  }
  return String(a.fileRef || '').localeCompare(String(b.fileRef || ''));
}

function toDisplayDateTime(value) {
  if (!value) {
    return 'unknown time';
  }
  var dt = new Date(value);
  if (isNaN(dt.getTime())) {
    return 'unknown time';
  }
  return dt.toLocaleString();
}

function isQcBackendUnreachable(errorLike) {
  if (!errorLike) {
    return false;
  }
  var reason = String(errorLike.reason || '').toUpperCase();
  var message = String(errorLike.message || '').toLowerCase();
  return (
    reason.indexOf('BACKEND_UNREACHABLE') !== -1 ||
    message.indexOf('backend is unavailable') !== -1 ||
    message.indexOf('failed to fetch') !== -1 ||
    message.indexOf('network') !== -1
  );
}

function setQcHydrationState(submissionId, status, message) {
  qcState.hydrationStateBySubmissionId[submissionId] = {
    status: status,
    message: message || '',
  };
}

function getQcHydrationState(submissionId) {
  return qcState.hydrationStateBySubmissionId[submissionId] || { status: 'idle', message: '' };
}

function buildSubmissionOptionLabel(submission) {
  var prefix = submission.packName ? submission.packName + ' (' : '';
  var suffix = submission.packName ? ')' : '';
  return prefix + submission.submissionId + suffix;
}

function ensureKnownQcSubmission(submissionId, label, updatedAt) {
  var normalizedId = String(submissionId || '').trim();
  if (!normalizedId) {
    return;
  }
  var existing = qcState.knownSubmissions.find(function (item) {
    return item.submissionId === normalizedId;
  });
  if (existing) {
    if (label) {
      existing.label = label;
    }
    if (updatedAt) {
      existing.updatedAt = updatedAt;
    }
    return;
  }
  qcState.knownSubmissions.push({
    submissionId: normalizedId,
    label: label || normalizedId,
    updatedAt: updatedAt || '',
  });
}

function collectKnownQcSubmissions() {
  var indexed = {};
  qcState.knownSubmissions.forEach(function (item) {
    if (!item || !item.submissionId) {
      return;
    }
    indexed[item.submissionId] = {
      submissionId: item.submissionId,
      label: item.label || item.submissionId,
      updatedAt: item.updatedAt || '',
    };
  });
  Object.keys(qcState.runsBySubmissionId).forEach(function (submissionId) {
    if (!indexed[submissionId]) {
      indexed[submissionId] = {
        submissionId: submissionId,
        label: submissionId,
        updatedAt: '',
      };
    }
  });
  var typedSubmissionId = getValue('qc-submission-id');
  if (typedSubmissionId && !indexed[typedSubmissionId]) {
    indexed[typedSubmissionId] = {
      submissionId: typedSubmissionId,
      label: typedSubmissionId,
      updatedAt: '',
    };
  }
  if (qcState.activeSubmissionId && !indexed[qcState.activeSubmissionId]) {
    indexed[qcState.activeSubmissionId] = {
      submissionId: qcState.activeSubmissionId,
      label: qcState.activeSubmissionId,
      updatedAt: '',
    };
  }
  return Object.keys(indexed)
    .map(function (key) { return indexed[key]; })
    .sort(function (a, b) {
      var aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      var bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return String(a.submissionId).localeCompare(String(b.submissionId));
    });
}

function renderQcSubmissionSelector() {
  var selector = document.getElementById('qc-report-submission-selector');
  if (!selector) {
    return;
  }
  var options = collectKnownQcSubmissions();
  qcState.knownSubmissions = options;
  if (options.length === 0) {
    selector.disabled = true;
    selector.innerHTML = '<option value="">No submissions found</option>';
    selector.value = '';
    return;
  }
  selector.disabled = false;
  selector.innerHTML = options
    .map(function (item) {
      return '<option value="' + escapeHtml(item.submissionId) + '">' + escapeHtml(item.label) + '</option>';
    })
    .join('');
  if (!qcState.activeSubmissionId || !options.some(function (item) { return item.submissionId === qcState.activeSubmissionId; })) {
    qcState.activeSubmissionId = options[0].submissionId;
  }
  selector.value = qcState.activeSubmissionId;
  setValue('qc-submission-id', qcState.activeSubmissionId);
}

function formatQcRunSelectorLabel(run) {
  var status = String(run.status || 'not_run').toUpperCase();
  var startedAt = toDisplayDateTime(run.startedAt || run.completedAt);
  return run.runId + ' (' + status + ', ' + startedAt + ')';
}

function renderQcRunSelector() {
  var selector = document.getElementById('qc-report-run-selector');
  if (!selector) {
    return;
  }
  var bucket = qcState.runsBySubmissionId[qcState.activeSubmissionId];
  var history = bucket && Array.isArray(bucket.history) ? bucket.history.slice() : [];
  history.sort(function (a, b) {
    var aTime = a.completedAt ? Date.parse(a.completedAt) : 0;
    var bTime = b.completedAt ? Date.parse(b.completedAt) : 0;
    return bTime - aTime;
  });

  if (history.length === 0) {
    selector.disabled = true;
    selector.innerHTML = '<option value="">No runs</option>';
    selector.value = '';
    delete qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId];
    return;
  }

  selector.disabled = false;
  selector.innerHTML = history
    .map(function (run) {
      return '<option value="' + escapeHtml(run.runId) + '">' + escapeHtml(formatQcRunSelectorLabel(run)) + '</option>';
    })
    .join('');

  var activeRunId = qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId];
  var activeRunExists = activeRunId && history.some(function (run) { return run.runId === activeRunId; });
  if (!activeRunExists) {
    activeRunId = history[0].runId;
    qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId] = activeRunId;
  }
  selector.value = activeRunId;
}

function getActiveQcRun() {
  var bucket = qcState.runsBySubmissionId[qcState.activeSubmissionId];
  if (!bucket || !Array.isArray(bucket.history) || bucket.history.length === 0) {
    return null;
  }
  var activeRunId = qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId];
  if (activeRunId) {
    var selected = bucket.history.find(function (run) { return run.runId === activeRunId; });
    if (selected) {
      return selected;
    }
  }
  return bucket.latest || bucket.history[bucket.history.length - 1] || null;
}

function setQcReportFeedback(tone, message) {
  setFeedback('qc-report-feedback', tone, message);
}

function renderQcResultsTable(container, findings) {
  var catalog = getQcCatalogApi();
  var categoryOrder = catalog.CATEGORY_ORDER || ['folder', 'audio-zip', 'samples', 'demo', 'description', 'artwork', 'presets', 'midi'];
  var labels = catalog.CATEGORY_LABELS || {};
  var severityFilter = qcState.severityFilter;
  var categoryFilter = qcState.categoryFilter;

  var filtered = findings
    .filter(function (finding) {
      return severityFilter === 'all' ? true : finding.severity === severityFilter;
    })
    .filter(function (finding) {
      return categoryFilter === 'all' ? true : finding.category === categoryFilter;
    })
    .sort(compareFindingOrder);

  if (filtered.length === 0) {
    container.innerHTML = '<p class=\"auth-subtle\">No findings match the active filters.</p>';
    return;
  }

  var groups = {};
  categoryOrder.forEach(function (category) { groups[category] = []; });
  filtered.forEach(function (finding) {
    var key = groups[finding.category] ? finding.category : inferQcCategoryFromRuleId(finding.ruleId);
    if (!groups[key]) { groups[key] = []; }
    groups[key].push(finding);
  });

  var html = '';
  categoryOrder.forEach(function (category) {
    var rows = groups[category] || [];
    if (rows.length === 0) { return; }
    html += '<section class=\"space-y-2\">';
    html += '<h4 class=\"fe-section-heading\">' + escapeHtml(labels[category] || category) + '</h4>';
    html += '<div class=\"fe-table-wrap\"><table class=\"fe-table\"><thead><tr>';
    html += '<th class=\"fe-th\">Severity</th><th class=\"fe-th\">Status</th><th class=\"fe-th\">Rule</th><th class=\"fe-th\">File</th><th class=\"fe-th\">Message</th><th class=\"fe-th\">Remediation</th>';
    html += '</tr></thead><tbody>';
    rows.forEach(function (finding) {
      var severityClass = finding.severity === 'blocking'
        ? 'border-brand-danger bg-red-50 text-brand-danger'
        : 'border-amber-500 bg-amber-50 text-amber-800';
      var statusClass = finding.diffTag === 'new'
        ? 'border-blue-500 bg-blue-50 text-blue-800'
        : finding.diffTag === 'resolved'
          ? 'border-gray-500 bg-gray-100 text-gray-700'
          : 'border-brand-border bg-brand-surface-alt text-brand-text';
      html += '<tr>';
      html += '<td class=\"fe-td\"><span class=\"inline-flex rounded-brand-pill border px-3 py-1 text-xs font-semibold uppercase ' + severityClass + '\">' + escapeHtml(finding.severity) + '</span></td>';
      html += '<td class=\"fe-td\"><span class=\"inline-flex rounded-brand-pill border px-3 py-1 text-xs font-semibold uppercase ' + statusClass + '\">' + escapeHtml((finding.diffTag || 'unchanged').toUpperCase()) + '</span></td>';
      html += '<td class=\"fe-td font-mono text-xs\">' + escapeHtml(finding.ruleId) + '</td>';
      html += '<td class=\"fe-td font-mono text-xs\">' + escapeHtml(finding.fileRef || '—') + '</td>';
      html += '<td class=\"fe-td\">' + escapeHtml(finding.message) + '</td>';
      html += '<td class=\"fe-td\">' + escapeHtml(finding.remediation) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div></section>';
  });
  container.innerHTML = html;
}

function renderQcReportView() {
  renderQcSubmissionSelector();
  renderQcRunSelector();

  var run = getActiveQcRun();
  var summaryText = document.getElementById('qc-results-summary');
  var blockingCount = document.getElementById('qc-report-blocking-count');
  var warningCount = document.getElementById('qc-report-warning-count');
  var passFailBadge = document.getElementById('qc-report-pass-fail');
  var resolvedSummary = document.getElementById('qc-report-resolved-summary');
  var findingsContainer = document.getElementById('qc-results-findings');
  var hydrationState = getQcHydrationState(qcState.activeSubmissionId);

  if (!run) {
    if (summaryText) {
      if (hydrationState.status === 'unreachable') {
        summaryText.textContent = 'QC history unavailable because the backend is unreachable. Next step: start the backend service, then refresh this report.';
      } else if (hydrationState.status === 'empty') {
        summaryText.textContent = 'No QC runs found for this submission.';
      } else {
        summaryText.textContent = 'Run QC to load report details.';
      }
    }
    if (blockingCount) { blockingCount.textContent = '0'; }
    if (warningCount) { warningCount.textContent = '0'; }
    if (passFailBadge) {
      passFailBadge.textContent = 'NOT RUN';
      passFailBadge.className = 'inline-flex items-center rounded-brand-pill border border-brand-border bg-brand-surface-alt px-3 py-1 text-xs font-semibold text-brand-text';
    }
    if (resolvedSummary) { resolvedSummary.textContent = hydrationState.status === 'empty' ? 'No previous run to compare for this submission.' : 'No previous run to compare.'; }
    if (findingsContainer) {
      if (hydrationState.status === 'unreachable') {
        findingsContainer.innerHTML = '<p class=\"auth-subtle\">Backend is unreachable. Start the API service and retry.</p>';
        setQcReportFeedback('error', hydrationState.message || 'QC backend is unreachable. Next step: start the backend service and retry.');
      } else if (hydrationState.status === 'empty') {
        findingsContainer.innerHTML = '<p class=\"auth-subtle\">No findings yet for this submission.</p>';
        setQcReportFeedback('', '');
      } else {
        findingsContainer.innerHTML = '<p class=\"auth-subtle\">Run a QC check from Upload & QC to see findings here.</p>';
        setQcReportFeedback('', '');
      }
    }
    return;
  }
  setQcReportFeedback('', '');

  var blockingFindings = run.findings.filter(function (finding) { return finding.severity === 'blocking'; });
  var warningFindings = run.findings.filter(function (finding) { return finding.severity === 'warning'; });
  var statusLabel = run.status === 'passed' ? 'PASS' : 'FAIL';
  var summary = 'Run ' + run.runId + ' — ' + statusLabel + ' (' + blockingFindings.length + ' blocking, ' + warningFindings.length + ' warning).';
  if (summaryText) { summaryText.textContent = summary; }
  if (blockingCount) { blockingCount.textContent = String(blockingFindings.length); }
  if (warningCount) { warningCount.textContent = String(warningFindings.length); }
  if (passFailBadge) {
    passFailBadge.textContent = statusLabel;
    passFailBadge.className = run.status === 'passed'
      ? 'inline-flex items-center rounded-brand-pill border border-green-700 bg-green-50 px-3 py-1 text-xs font-semibold text-green-800'
      : 'inline-flex items-center rounded-brand-pill border border-brand-danger bg-red-50 px-3 py-1 text-xs font-semibold text-brand-danger';
  }
  if (resolvedSummary) {
    resolvedSummary.textContent = run.resolvedCount > 0
      ? run.resolvedCount + ' issues resolved since last run.'
      : 'No issues resolved since last run.';
  }

  var displayFindings = run.findings.concat(run.resolvedFindings || []);
  if (findingsContainer) {
    renderQcResultsTable(findingsContainer, displayFindings);
  }
}

function persistQcRun(submissionId, runRecord) {
  var bucket = qcState.runsBySubmissionId[submissionId];
  if (!bucket) {
    bucket = { history: [], latest: null };
    qcState.runsBySubmissionId[submissionId] = bucket;
  }

  var existingIndex = bucket.history.findIndex(function (entry) {
    return entry.runId === runRecord.runId;
  });
  if (existingIndex === -1) {
    bucket.history.push(runRecord);
  } else {
    bucket.history[existingIndex] = runRecord;
  }
  bucket.latest = runRecord;
  qcState.activeSubmissionId = submissionId;
  qcState.activeRunIdBySubmissionId[submissionId] = runRecord.runId;
  setQcHydrationState(submissionId, 'ready', '');
  ensureKnownQcSubmission(submissionId, null, runRecord.completedAt || runRecord.startedAt || '');
}

function hydrateQcHistoryFromBackend(submissionId) {
  if (!api || !api.qc || !api.qc.getResults) {
    setQcHydrationState(submissionId, 'unreachable', 'QC API not available.');
    return Promise.resolve(false);
  }

  return api.qc.getResults({ submissionId: submissionId })
    .then(function (resultsResponse) {
      if (!resultsResponse || !resultsResponse.ok) {
        var errorPayload = resultsResponse && resultsResponse.error ? resultsResponse.error : {};
        if (isQcBackendUnreachable(errorPayload)) {
          setQcHydrationState(submissionId, 'unreachable', 'QC backend is unreachable. Next step: start the backend service and retry.');
        } else {
          var failureMessage = errorPayload.message || 'Failed to load QC history.';
          setQcHydrationState(submissionId, 'error', failureMessage);
        }
        return false;
      }

      var historyPayload = Array.isArray(resultsResponse.data.history) ? resultsResponse.data.history.slice() : [];
      var latestPayload = resultsResponse.data || {};
      if (
        historyPayload.length === 0 &&
        latestPayload.runId &&
        latestPayload.status &&
        latestPayload.status !== 'not_run'
      ) {
        historyPayload = [latestPayload];
      }

      if (historyPayload.length === 0) {
        qcState.runsBySubmissionId[submissionId] = { history: [], latest: null };
        delete qcState.activeRunIdBySubmissionId[submissionId];
        setQcHydrationState(submissionId, 'empty', 'No QC runs found for this submission.');
        ensureKnownQcSubmission(submissionId, null, '');
        return true;
      }

      var builtHistory = [];
      historyPayload.forEach(function (runPayload, index) {
        var fallbackRunId = runPayload.runId || ('qc-history-run-' + index);
        var fallbackStatus = runPayload.status || 'not_run';
        var fallbackStartedAt = runPayload.startedAt || null;
        var fallbackCompletedAt = runPayload.completedAt || null;
        var fallbackFindings = Array.isArray(runPayload.findings) ? runPayload.findings : [];
        var previous = builtHistory.length > 0 ? builtHistory[builtHistory.length - 1] : null;
        var mapped = mapResultsData(
          runPayload,
          fallbackRunId,
          fallbackStatus,
          fallbackStartedAt,
          fallbackCompletedAt,
          fallbackFindings
        );
        builtHistory.push(applyFindingDiff(mapped, previous));
      });

      qcState.runsBySubmissionId[submissionId] = {
        history: builtHistory,
        latest: builtHistory.length > 0 ? builtHistory[builtHistory.length - 1] : null,
      };
      var previousActiveRunId = qcState.activeRunIdBySubmissionId[submissionId];
      var previousExists = previousActiveRunId && builtHistory.some(function (run) { return run.runId === previousActiveRunId; });
      qcState.activeRunIdBySubmissionId[submissionId] = previousExists
        ? previousActiveRunId
        : builtHistory[builtHistory.length - 1].runId;
      setQcHydrationState(submissionId, 'ready', '');
      var latestRun = builtHistory[builtHistory.length - 1];
      ensureKnownQcSubmission(submissionId, null, latestRun.completedAt || latestRun.startedAt || '');
      return true;
    })
    .catch(function (error) {
      if (isQcBackendUnreachable(error)) {
        setQcHydrationState(submissionId, 'unreachable', 'QC backend is unreachable. Next step: start the backend service and retry.');
      } else {
        setQcHydrationState(submissionId, 'error', 'Failed to load QC history.');
      }
      return false;
    });
}

function refreshQcSubmissionHistoryIndex() {
  if (!api || !api.submissions || !api.submissions.list) {
    renderQcReportView();
    return Promise.resolve(false);
  }
  var actorId = appState.actor.id || notificationState.actorId || 'desktop-local';
  return api.submissions.list({ creatorId: actorId, actorId: actorId })
    .then(function (response) {
      if (!response || !response.ok) {
        var errorPayload = response && response.error ? response.error : {};
        if (isQcBackendUnreachable(errorPayload)) {
          setQcHydrationState(qcState.activeSubmissionId, 'unreachable', 'QC backend is unreachable. Next step: start the backend service and retry.');
        } else {
          setQcHydrationState(qcState.activeSubmissionId, 'error', errorPayload.message || 'Failed to load submissions for QC history.');
        }
        renderQcReportView();
        return false;
      }
      var items = Array.isArray(response.data.submissions) ? response.data.submissions : [];
      items.forEach(function (submission) {
        ensureKnownQcSubmission(
          submission.submissionId,
          buildSubmissionOptionLabel(submission),
          submission.updatedAt || ''
        );
      });
      renderQcSubmissionSelector();
      return hydrateQcHistoryFromBackend(qcState.activeSubmissionId).then(function () {
        renderQcReportView();
        return true;
      });
    })
    .catch(function () {
      setQcHydrationState(qcState.activeSubmissionId, 'unreachable', 'QC backend is unreachable. Next step: start the backend service and retry.');
      renderQcReportView();
      return false;
    });
}

function setActiveQcSubmission(submissionId) {
  var nextSubmissionId = String(submissionId || '').trim();
  if (!nextSubmissionId) {
    return Promise.resolve(false);
  }
  qcState.activeSubmissionId = nextSubmissionId;
  ensureKnownQcSubmission(nextSubmissionId, null, '');
  setValue('qc-submission-id', nextSubmissionId);
  renderQcSubmissionSelector();
  return hydrateQcHistoryFromBackend(nextSubmissionId).then(function () {
    renderQcReportView();
    return true;
  });
}

async function handleQcRun() {
  if (!api || !api.qc || !api.qc.evaluatePack) {
    setFeedback('qc-feedback', 'warning', 'QC API not available.');
    setQcReportFeedback('warning', 'QC API not available.');
    return;
  }

  setFeedback('qc-feedback', '', '');
  setQcReportFeedback('', '');
  var runButton = document.getElementById('qc-run-button');
  var rerunButton = document.getElementById('qc-report-rerun-button');
  setButtonBusy(runButton, true);
  setButtonBusy(rerunButton, true);

  try {
    var payload = buildQcEvaluationPayload();
    var startedAt = new Date().toISOString();
    var previousBucket = qcState.runsBySubmissionId[payload.submissionId];
    var previousRun = previousBucket ? previousBucket.latest : null;

    var evaluationResponse = await api.qc.evaluatePack(payload);
    if (!evaluationResponse.ok) {
      var msg = evaluationResponse.error && evaluationResponse.error.message ? evaluationResponse.error.message : 'QC evaluation failed.';
      setFeedback('qc-feedback', 'error', msg);
      setQcReportFeedback('error', msg);
      return;
    }

    var report = evaluationResponse.data.report || {};
    var mappedFromEvaluate = mapResultsData(
      report,
      payload.requestId,
      report.status || 'failed',
      startedAt,
      report.generatedAt || new Date().toISOString(),
      report.findings || []
    );

    var hydrated = await setActiveQcSubmission(payload.submissionId);
    var runRecord = hydrated ? getActiveQcRun() : null;
    if (!runRecord) {
      runRecord = applyFindingDiff(mappedFromEvaluate, previousRun);
      persistQcRun(payload.submissionId, runRecord);
    }

    var summary = runRecord.status === 'passed'
      ? 'QC PASSED — no blocking findings.'
      : 'QC FAILED — ' + runRecord.findings.filter(function (finding) { return finding.severity === 'blocking'; }).length + ' blocking finding(s).';
    setText('qc-report-summary', summary);
    setFeedback('qc-feedback', runRecord.status === 'passed' ? '' : 'error', runRecord.status === 'passed' ? '' : summary);
    var out = document.getElementById('qc-rules-output');
    if (out) {
      out.textContent = toPrettyJson({
        runId: runRecord.runId,
        submissionId: payload.submissionId,
        status: runRecord.status,
        startedAt: runRecord.startedAt,
        completedAt: runRecord.completedAt,
        findings: runRecord.findings,
        resolvedFindings: runRecord.resolvedFindings,
      });
    }
    renderQcReportView();
  } catch (err) {
    var message = 'QC failed: ' + err.message;
    setFeedback('qc-feedback', 'error', message);
    setQcReportFeedback('error', message);
  } finally {
    setButtonBusy(runButton, false);
    setButtonBusy(rerunButton, false);
  }
}

async function handleQcExportReport() {
  if (!api || !api.qc || !api.qc.exportReport) {
    setQcReportFeedback('warning', 'Export API not available.');
    return;
  }

  var run = getActiveQcRun();
  if (!run || !run.runId) {
    setQcReportFeedback('warning', 'Run QC before exporting findings.');
    return;
  }

  var exportButton = document.getElementById('qc-report-export-button');
  setButtonBusy(exportButton, true);
  setQcReportFeedback('', '');
  try {
    var response = await api.qc.exportReport({
      submissionId: qcState.activeSubmissionId,
      runId: run.runId,
      generatedAt: run.generatedAt || run.completedAt || new Date().toISOString(),
      ruleSetVersion: run.ruleSetVersion || 'unknown',
      policyVersion: run.policyVersion || 1,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      findings: run.findings.concat(run.resolvedFindings || []).map(function (finding) {
        return {
          findingId: finding.findingId,
          ruleId: finding.ruleId,
          severity: finding.severity,
          category: finding.category,
          fileRef: finding.fileRef || null,
          message: finding.message,
          remediation: finding.remediation,
          diffTag: finding.diffTag || 'unchanged',
        };
      }),
    });

    if (!response.ok) {
      setQcReportFeedback('error', response.error && response.error.message ? response.error.message : 'Export failed.');
      return;
    }
    if (response.data.canceled) {
      setQcReportFeedback('warning', 'Export canceled.');
      return;
    }
    setQcReportFeedback('', 'Findings exported to ' + response.data.path);
  } catch (err) {
    setQcReportFeedback('error', 'Export failed: ' + err.message);
  } finally {
    setButtonBusy(exportButton, false);
  }
}

function handleQcFilterChange() {
  qcState.severityFilter = getValue('qc-report-severity-filter') || 'all';
  qcState.categoryFilter = getValue('qc-report-category-filter') || 'all';
  renderQcReportView();
}

function handleQcRunSelectorChange() {
  var selectedRunId = getValue('qc-report-run-selector');
  if (!selectedRunId) {
    return;
  }
  qcState.activeRunIdBySubmissionId[qcState.activeSubmissionId] = selectedRunId;
  renderQcReportView();
}

function handleQcSubmissionSelectorChange() {
  var selectedSubmissionId = getValue('qc-report-submission-selector');
  if (!selectedSubmissionId) {
    return;
  }
  void setActiveQcSubmission(selectedSubmissionId);
}

function syncQcSubmissionIdToState() {
  var id = getValue('qc-submission-id');
  if (id) {
    void setActiveQcSubmission(id);
  }
}

function restoreQcFilters() {
  setValue('qc-report-severity-filter', qcState.severityFilter);
  setValue('qc-report-category-filter', qcState.categoryFilter);
  renderQcSubmissionSelector();
  renderQcRunSelector();
}

async function handleQcRunFromReport() {
  if (!getValue('qc-submission-id')) {
    setValue('qc-submission-id', qcState.activeSubmissionId || 'sub-local-1');
  }
  await handleQcRun();
}

async function handleQcLoadRules() {
  if (!api || !api.qc || !api.qc.listRules) {
    setFeedback('qc-feedback', 'warning', 'QC API not available.'); return;
  }
  setFeedback('qc-feedback', '', '');
  var btn = document.getElementById('qc-rules-button');
  setButtonBusy(btn, true);
  try {
    var r = await api.qc.listRules();
    if (!r.ok) {
      setFeedback('qc-feedback', 'error', r.error.message || 'Failed to load rules.'); return;
    }
    var out = document.getElementById('qc-rules-output');
    if (out) { out.textContent = toPrettyJson(r.data); }
    setFeedback('qc-feedback', '', 'Rules loaded: ' + (r.data.rules ? r.data.rules.length : 0) + ' entries.');
    var el = document.getElementById('qc-feedback');
    if (el) { el.textContent = 'Rules loaded: ' + (r.data.rules ? r.data.rules.length : 0) + ' entries.'; el.className = 'auth-feedback'; }
  } catch (err) {
    setFeedback('qc-feedback', 'error', 'Failed to load rules: ' + err.message);
  } finally {
    setButtonBusy(btn, false);
  }
}

async function handleQcPolicyLoad() {
  if (!api || !api.qc || !api.qc.getPolicy) {
    setFeedback('qc-feedback', 'warning', 'QC policy API not available.'); return;
  }
  var btn = document.getElementById('qc-policy-button');
  setButtonBusy(btn, true);
  try {
    var r = await api.qc.getPolicy();
    if (!r.ok) { return; }
    var ta = document.getElementById('qc-policy-json');
    if (ta) { ta.value = toPrettyJson(r.data.policy); }
    var out = document.getElementById('qc-policy-output');
    if (out) { out.textContent = 'Policy loaded: ' + r.data.policy.policyId; }
  } catch (err) {
    logQcAdminError('handleQcPolicyLoad', err);
  }
  finally { setButtonBusy(btn, false); }
}

async function handleQcPolicySave() {
  if (!api || !api.qc || !api.qc.updatePolicy) { return; }
  var btn = document.getElementById('qc-policy-save-button');
  setButtonBusy(btn, true);
  try {
    var raw = getValue('qc-policy-json');
    var policy = JSON.parse(raw);
    var r = await api.qc.updatePolicy({ policy });
    var out = document.getElementById('qc-policy-output');
    if (out) { out.textContent = r.ok ? ('Saved: v' + r.data.policy.version) : ('Error: ' + r.error.message); }
  } catch (err) {
    var out = document.getElementById('qc-policy-output');
    if (out) { out.textContent = 'Invalid JSON: ' + err.message; }
  } finally {
    setButtonBusy(btn, false);
  }
}

function wireQcAdminFlows() {
  document.getElementById('qc-run-button')?.addEventListener('click', handleQcRun);
  document.getElementById('qc-rules-button')?.addEventListener('click', handleQcLoadRules);
  document.getElementById('qc-submission-id')?.addEventListener('change', syncQcSubmissionIdToState);
  document.getElementById('qc-report-submission-selector')?.addEventListener('change', handleQcSubmissionSelectorChange);
  document.getElementById('qc-report-run-selector')?.addEventListener('change', handleQcRunSelectorChange);
  document.getElementById('qc-policy-button')?.addEventListener('click', handleQcPolicyLoad);
  document.getElementById('qc-policy-save-button')?.addEventListener('click', handleQcPolicySave);
  document.getElementById('qc-report-severity-filter')?.addEventListener('change', handleQcFilterChange);
  document.getElementById('qc-report-category-filter')?.addEventListener('change', handleQcFilterChange);
  document.getElementById('qc-report-rerun-button')?.addEventListener('click', handleQcRunFromReport);
  document.getElementById('qc-report-export-button')?.addEventListener('click', handleQcExportReport);
  restoreQcFilters();
  refreshQcSubmissionHistoryIndex().then(function () {
    renderQcReportView();
  });
}



  // Exposed functions
  global.wireQcAdminFlows = wireQcAdminFlows;
  global.renderQcReportView = renderQcReportView;
  global.refreshQcSubmissionHistoryIndex = refreshQcSubmissionHistoryIndex;
  global.setActiveQcSubmission = setActiveQcSubmission;
  global.syncQcSubmissionIdToState = syncQcSubmissionIdToState;
  global.restoreQcFilters = restoreQcFilters;
  global.handleQcSubmissionSelectorChange = handleQcSubmissionSelectorChange;
  global.handleQcRunSelectorChange = handleQcRunSelectorChange;
  global.handleQcFilterChange = handleQcFilterChange;
  global.handleQcRunFromReport = handleQcRunFromReport;
  global.handleQcExportReport = handleQcExportReport;
  global.handleQcPolicyLoad = handleQcPolicyLoad;
  global.handleQcPolicySave = handleQcPolicySave;
  global.handleQcLoadRules = handleQcLoadRules;
  global.handleQcRun = handleQcRun;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
