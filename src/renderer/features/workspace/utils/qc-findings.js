(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceQcFindings = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function getQcCatalogApi() {
    var catalog = (
      typeof globalThis !== 'undefined' &&
      globalThis.qcGuidanceCatalog &&
      typeof globalThis.qcGuidanceCatalog.resolveGuidance === 'function'
    ) ? globalThis.qcGuidanceCatalog : null;
    if (catalog) {
      return catalog;
    }
    return {
      resolveGuidance: function (ruleId) {
        var normalized = String(ruleId || '').toUpperCase() || 'UNKNOWN_RULE';
        return {
          title: normalized,
          description: 'This QC issue requires review.',
          remediation: 'Fix the issue and rerun QC.',
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
    if (value.indexOf('SAMPLE') !== -1 || value.indexOf('PACK.SAMPLE') === 0 || value.indexOf('PACK.NAMING') === 0) {
      return 'samples';
    }
    if (value.indexOf('DEMO') !== -1) { return 'demo'; }
    if (value.indexOf('DESCRIPTION') !== -1) { return 'description'; }
    if (value.indexOf('ART') !== -1 || value.indexOf('ARTWORK') !== -1) { return 'artwork'; }
    if (value.indexOf('PRESET') !== -1) { return 'presets'; }
    if (value.indexOf('MIDI') !== -1) { return 'midi'; }
    return 'folder';
  }

  function formatQcSize(bytes) {
    if (!Number.isFinite(bytes)) { return '-'; }
    if (bytes >= 1024 * 1024 * 1024) { return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'; }
    if (bytes >= 1024 * 1024) { return (bytes / (1024 * 1024)).toFixed(2) + ' MB'; }
    if (bytes >= 1024) { return (bytes / 1024).toFixed(2) + ' KB'; }
    return String(bytes) + ' B';
  }

  function extractFindingFileRef(finding) {
    if (finding && finding.fileRef) { return finding.fileRef; }
    var context = finding && finding.context ? finding.context : {};
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

  function normalizeFindingSeverity(finding) {
    var severity = String((finding && finding.severity) || '').toLowerCase();
    var status = String((finding && finding.status) || '').toLowerCase();
    if (finding && (finding.blocking || severity === 'blocking' || status === 'failed')) {
      return 'blocking';
    }
    return 'warning';
  }

  function compareFindings(a, b) {
    if (a.severity !== b.severity) {
      return a.severity === 'blocking' ? -1 : 1;
    }
    if (a.ruleId !== b.ruleId) {
      return String(a.ruleId).localeCompare(String(b.ruleId));
    }
    return String(a.fileRef || '').localeCompare(String(b.fileRef || ''));
  }

  function normalizeQcFinding(finding) {
    var catalog = getQcCatalogApi();
    var ruleId = (finding && (finding.ruleId || finding.rule_id)) ? (finding.ruleId || finding.rule_id) : 'UNKNOWN_RULE';
    var guidance = catalog.resolveGuidance(ruleId);
    var context = finding && finding.context ? finding.context : {};
    var fileRef = extractFindingFileRef(finding);
    var remediationTemplate = (finding && finding.remediation) || guidance.remediation || 'Fix this issue and rerun QC.';
    var remediation = remediationTemplate;
    if (typeof catalog.formatTemplate === 'function') {
      remediation = catalog.formatTemplate(remediationTemplate, {
        size: formatQcSize(context.audio_zip_size_bytes || context.size_bytes || context.size),
        count: context.sample_count || context.count || '-',
        file_ref: fileRef || '-',
      });
    }
    return {
      findingId: (finding && (finding.findingId || finding.finding_id)) || (ruleId + ':' + (fileRef || 'unknown')),
      ruleId: String(ruleId),
      severity: normalizeFindingSeverity(finding),
      category: (finding && finding.category) || guidance.category || inferQcCategoryFromRuleId(ruleId),
      fileRef: fileRef,
      message: (finding && finding.message) || guidance.description || 'QC issue found.',
      remediation: remediation,
    };
  }

  function normalizeQcFindings(findings) {
    return (Array.isArray(findings) ? findings : [])
      .map(normalizeQcFinding)
      .sort(compareFindings);
  }

  return {
    getQcCatalogApi: getQcCatalogApi,
    inferQcCategoryFromRuleId: inferQcCategoryFromRuleId,
    formatQcSize: formatQcSize,
    extractFindingFileRef: extractFindingFileRef,
    normalizeFindingSeverity: normalizeFindingSeverity,
    compareFindings: compareFindings,
    normalizeQcFinding: normalizeQcFinding,
    normalizeQcFindings: normalizeQcFindings
  };
});
