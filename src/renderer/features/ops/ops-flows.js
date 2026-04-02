(function(global) {
/* Operations Flows (Admin) — extracted from renderer.js */
/* globals appState, api, getValue, requiredOpsValue, appendOpsTimeline, setFeedback */
function appendOpsTimeline(entry) {
  var out = document.getElementById('ops-timeline-output');
  if (!out) { return; }
  var line = '[' + new Date().toISOString() + '] ' + entry;
  out.textContent = (line + '\n' + (out.textContent || '')).trim();
}

function requiredOpsValue(id, label) {
  var val = getValue(id);
  if (!val) { throw new Error(label + ' is required'); }
  return val;
}

function buildSchedulingEvent(submissionId, actorId, preferredMonth) {
  return {
    eventName: 'submission.approved.scheduling.v1', schemaVersion: 1, submissionId,
    transitionId: 'transition-' + Date.now(), occurredAt: new Date().toISOString(),
    approvedBy: actorId, preferredReleaseMonth: preferredMonth,
    idempotencyKey: 'submission.approved.scheduling.v1:' + submissionId + ':' + Date.now(),
  };
}

function buildOpsIncidentIdempotencyKey(payload) {
  var base = [
    payload.source,
    payload.severity,
    payload.note.trim().toLowerCase(),
    payload.linkedEntity,
    payload.failureClass || 'none',
    payload.correlationId || 'none',
    payload.auditEventId || 'none',
  ].join('|');
  var hash = 0;
  for (var i = 0; i < base.length; i += 1) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) >>> 0;
  }
  return 'ops-incident-' + hash.toString(16);
}

function inferFailureClassFromOpsContext(note, jobId) {
  if (jobId) { return 'retry_exhaustion'; }
  var lower = note.toLowerCase();
  if (lower.indexOf('schedule') >= 0 || lower.indexOf('release') >= 0) {
    return 'scheduling_terminal_failure';
  }
  if (lower.indexOf('integration') >= 0 || lower.indexOf('airtable') >= 0 || lower.indexOf('dropbox') >= 0) {
    return 'integration_failure';
  }
  return null;
}

function summarizeOpsMetricsSnapshot(snapshot) {
  var lines = String(snapshot || '').split('\n');
  var queueDepth = 'n/a';
  var incidentCount = '0';
  var failureSummaries = [];
  lines.forEach(function (line) {
    if (!line || line.charAt(0) === '#') { return; }
    if (line.indexOf('splice_api_background_job_queue_depth') === 0) {
      queueDepth = (line.split(' ').pop() || 'n/a').trim();
      return;
    }
    if (line.indexOf('splice_api_incident_annotations_total') === 0) {
      incidentCount = (line.split(' ').pop() || incidentCount).trim();
      return;
    }
    if (line.indexOf('splice_api_failure_class_total') === 0) {
      failureSummaries.push(line);
    }
  });
  return [
    'Actionable signals:',
    '- Queue depth: ' + queueDepth,
    '- Incident annotations: ' + incidentCount,
    '- Failure classes:',
    failureSummaries.length > 0 ? failureSummaries.join('\n') : 'none',
  ].join('\n');
}

async function runOpsAction(buttonId, action) {
  var btn = document.getElementById(buttonId);
  setButtonBusy(btn, true);
  setFeedback('ops-feedback', '', '');
  try { await action(); }
  catch (err) { setFeedback('ops-feedback', 'error', err.message); appendOpsTimeline('error: ' + err.message); }
  finally { setButtonBusy(btn, false); }
}

function wireOperationsFlows() {
  document.getElementById('ops-jobs-enqueue')?.addEventListener('click', function () {
    runOpsAction('ops-jobs-enqueue', async function () {
      var submissionId = requiredOpsValue('ops-submission-id', 'Submission ID');
      var r = await api.jobs.enqueue({ requestId: 'enqueue-' + Date.now(), jobType: 'release.trigger', idempotencyKey: 'release.trigger:' + submissionId, payloadJson: { submissionId } });
      if (!r.ok) { throw new Error(r.error.message); }
      setFeedback('ops-feedback', '', 'Enqueued job ' + r.data.job.id + '.');
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Enqueued job ' + r.data.job.id + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('job enqueued ' + r.data.job.id);
    });
  });

  document.getElementById('ops-jobs-get')?.addEventListener('click', function () {
    runOpsAction('ops-jobs-get', async function () {
      var jobId = requiredOpsValue('ops-job-id', 'Job ID');
      var r = await api.jobs.get({ id: jobId });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Job ' + r.data.job.id + ' is ' + r.data.job.status + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('job lookup ' + r.data.job.id + ':' + r.data.job.status);
    });
  });

  document.getElementById('ops-jobs-replay')?.addEventListener('click', function () {
    runOpsAction('ops-jobs-replay', async function () {
      var jobId = requiredOpsValue('ops-job-id', 'Job ID');
      var actorId = requiredOpsValue('ops-actor-id', 'Actor ID');
      var r = await api.jobs.replay({ id: jobId, requestId: 'replay-' + Date.now(), actorId, reason: 'manual replay from operations ui' });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Replay accepted for ' + r.data.job.id + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('job replayed ' + r.data.job.id);
    });
  });

  document.getElementById('ops-scheduling-resolve')?.addEventListener('click', function () {
    runOpsAction('ops-scheduling-resolve', async function () {
      var submissionId = requiredOpsValue('ops-submission-id', 'Submission ID');
      var actorId = requiredOpsValue('ops-actor-id', 'Actor ID');
      var preferredMonth = requiredOpsValue('ops-preferred-month', 'Preferred month');
      var r = await api.scheduling.resolve({ requestId: 'resolve-' + Date.now(), submissionId, schedulingEvent: buildSchedulingEvent(submissionId, actorId, preferredMonth), timezone: 'UTC' });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Resolved schedule v' + r.data.schedule.version + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('schedule resolved ' + r.data.schedule.submissionId);
    });
  });

  document.getElementById('ops-scheduling-override')?.addEventListener('click', function () {
    runOpsAction('ops-scheduling-override', async function () {
      var submissionId = requiredOpsValue('ops-submission-id', 'Submission ID');
      var actorId = requiredOpsValue('ops-actor-id', 'Actor ID');
      var newReleaseAt = new Date(Date.now() + 7 * 86400000).toISOString();
      var r = await api.scheduling.override({ requestId: 'override-' + Date.now(), submissionId, newReleaseAt, reason: 'manual override from operations ui', actorId, actorRole: 'admin', timezone: 'UTC' });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Override saved for ' + submissionId + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('schedule overridden ' + submissionId);
    });
  });

  document.getElementById('ops-scheduling-trigger')?.addEventListener('click', function () {
    runOpsAction('ops-scheduling-trigger', async function () {
      var submissionId = requiredOpsValue('ops-submission-id', 'Submission ID');
      var actorId = requiredOpsValue('ops-actor-id', 'Actor ID');
      var r = await api.scheduling.triggerRelease({ requestId: 'trigger-' + Date.now(), submissionId, actorId, actorRole: 'admin', force: true });
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Release triggered for ' + submissionId + '.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('release triggered ' + submissionId);
    });
  });

  document.getElementById('ops-observability-metrics')?.addEventListener('click', function () {
    runOpsAction('ops-observability-metrics', async function () {
      var r = await api.observability.getMetrics();
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Loaded metrics snapshot.'; el.className = 'auth-feedback'; }
      var actionable = summarizeOpsMetricsSnapshot(r.data.snapshot);
      setText('ops-status-output', actionable + '\n\nRaw (truncated):\n' + r.data.snapshot.slice(0, 1400));
      appendOpsTimeline('metrics snapshot loaded');
    });
  });

  document.getElementById('ops-observability-annotate')?.addEventListener('click', function () {
    runOpsAction('ops-observability-annotate', async function () {
      var note = requiredOpsValue('ops-annotation-note', 'Annotation note');
      var submissionId = (getValue('ops-submission-id') || '').trim();
      var linkedEntity = submissionId ? ('submission:' + submissionId) : 'operations';
      var jobId = (getValue('ops-job-id') || '').trim();
      var failureClass = inferFailureClassFromOpsContext(note, jobId);
      var payload = {
        source: 'desktop-operations-ui',
        severity: failureClass ? 'critical' : 'warning',
        note: note,
        linkedEntity: linkedEntity,
        failureClass: failureClass,
        correlationId: jobId ? ('job:' + jobId) : null,
        remediationStatus: 'open',
        remediationLink: jobId ? ('/admin/jobs/' + jobId) : null,
        requestId: 'incident-' + Date.now(),
      };
      payload.idempotencyKey = buildOpsIncidentIdempotencyKey(payload);
      var r = await api.observability.annotateIncident(payload);
      if (!r.ok) { throw new Error(r.error.message); }
      var el = document.getElementById('ops-feedback'); if (el) { el.textContent = 'Annotation ' + r.data.annotation.id + ' saved.'; el.className = 'auth-feedback'; }
      setText('ops-status-output', toPrettyJson(r.data)); appendOpsTimeline('incident annotation ' + r.data.annotation.id);
    });
  });

  document.getElementById('ops-audit-events-btn')?.addEventListener('click', async function () {
    if (!api || !api.audit) { return; }
    try {
      var r = await api.audit.listSecurityEvents({ limit: 20, includeResolved: false });
      var out = document.getElementById('ops-audit-output');
      if (out) { out.textContent = r.ok ? toPrettyJson(r.data) : r.error.message; }
    } catch (err) {
      var out = document.getElementById('ops-audit-output');
      if (out) { out.textContent = err.message; }
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   SESSION BOOTSTRAP
═══════════════════════════════════════════════════════════ */

async function hydrateSessionContext() {
  if (!api || !api.auth || !api.auth.getSession) { return; }
  var r;
  try { r = await api.auth.getSession({ includePermissions: false }); }
  catch (_) { return; }
  if (!r || !r.ok) { return; }
  /* Guard: test teardown may delete global.document/window before this resolves */
  try {
    var docRef = (typeof globalThis !== 'undefined' ? globalThis : global).document;
    if (!docRef || typeof window === 'undefined' || !window.fileeaters) { return; }
    applyUserContext({ id: r.data.actor.id, roles: r.data.actor.roles });
    if (api.system) {
      if (api.system.versions) {
        setText('electron-version', api.system.versions.electron || '—');
        setText('chrome-version', api.system.versions.chrome || '—');
      }
      if (api.system.runtime) {
        setText('environment-name', api.system.runtime.environment || '—');
        setText('health-port', api.system.runtime.healthPort ? String(api.system.runtime.healthPort) : '—');
        var versionEl = docRef.getElementById ? docRef.getElementById('sidebar-version') : null;
        if (versionEl) { versionEl.textContent = 'env: ' + (api.system.runtime.environment || '?'); }
      }
    }
  } catch (_) { /* Swallow: test teardown may race with this async resolution */ }
}



/* ═══════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════ */




  // Exposed functions
  global.wireOperationsFlows = wireOperationsFlows;
  global.summarizeOpsMetricsSnapshot = summarizeOpsMetricsSnapshot;
  global.inferFailureClassFromOpsContext = inferFailureClassFromOpsContext;
  global.buildOpsIncidentIdempotencyKey = buildOpsIncidentIdempotencyKey;
  global.buildSchedulingEvent = buildSchedulingEvent;
  global.requiredOpsValue = requiredOpsValue;
  global.appendOpsTimeline = appendOpsTimeline;
  global.hydrateSessionContext = hydrateSessionContext;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
