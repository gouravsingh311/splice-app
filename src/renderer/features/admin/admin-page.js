/* Admin Page module: PRD-14 tabbed admin config operations */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.adminPage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var state = {
    actorId: "desktop-local-admin",
    actorRole: "admin",
    activeTab: "qc-rules",
    policy: null,
    rules: [],
    configs: [],
    integrationHealth: {
      dropbox: null,
      airtable: null,
      smtp: null,
    },
    opsHistory: [],
    complianceEvents: [],
    complianceExport: null,
    policyDraft: {
      policyId: "",
      ruleSetVersion: "",
      reason: "",
      normalizationTargetDb: "-1.0",
      normalizationToleranceDb: "0.7",
      normalizationStrict: false,
    },
    hasAppliedAdminBlockingDefault: false,
    isWired: false,
  };

  function getWrappers() {
    if (typeof globalThis !== "undefined" && globalThis.flowbiteWrappers) {
      return globalThis.flowbiteWrappers;
    }
    if (typeof window !== "undefined" && window.flowbiteWrappers) {
      return window.flowbiteWrappers;
    }
    return null;
  }

  function wrapControl(name, options, fallbackClass) {
    var wrappers = getWrappers();
    if (wrappers && typeof wrappers[name] === "function") {
      return wrappers[name](options || {});
    }
    return { className: fallbackClass || "", attrString: "" };
  }

  function getDesktopApi() {
    if (typeof globalThis === "undefined") {
      return null;
    }
    return globalThis.electronAPI || globalThis.fileeaters || null;
  }

  function logAdminPageError(scope, error) {
    var detail = error && error.message ? error.message : String(error || "unknown error");
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error("[admin-page] " + scope + " failed", detail);
    }
    return detail;
  }

  function hasAdminContext() {
    return Boolean(state.actorId && state.actorRole === "admin");
  }

  function promptValue(message, fallback) {
    if (typeof globalThis === "undefined" || typeof globalThis.prompt !== "function") {
      return fallback || "";
    }
    try {
      return globalThis.prompt(message, fallback || "") || "";
    } catch (_error) {
      return fallback || "";
    }
  }

  function runHighRiskConfirmation(options) {
    var canPrompt = typeof globalThis !== "undefined" && typeof globalThis.prompt === "function";
    if (!canPrompt) {
      if (typeof globalThis !== "undefined" && typeof globalThis.confirm === "function") {
        var approved = globalThis.confirm(options.confirmPrompt + " (Fallback: OK to continue)");
        if (!approved) {
          return null;
        }
        return {
          reason: options.defaultReason || "Operator confirmed action",
          confirmation: options.token,
        };
      }
      return null;
    }
    var reason = promptValue(options.reasonPrompt, options.defaultReason || "").trim();
    if (!reason) {
      return null;
    }
    var confirmation = promptValue(options.confirmPrompt, "").trim().toUpperCase();
    if (confirmation !== options.token) {
      return null;
    }
    return {
      reason: reason,
      confirmation: confirmation,
    };
  }

  function getTemplate() {
    var qcTab = wrapControl("button", {
      control: "admin-tab-qc-rules",
      type: "button",
      tone: "secondary",
    }, "auth-button-secondary");
    var configsTab = wrapControl("button", {
      control: "admin-tab-configs",
      type: "button",
      tone: "secondary",
    }, "auth-button-secondary");
    var integrationsTab = wrapControl("button", {
      control: "admin-tab-integrations",
      type: "button",
      tone: "secondary",
    }, "auth-button-secondary");
    var complianceTab = wrapControl("button", {
      control: "admin-tab-compliance",
      type: "button",
      tone: "secondary",
    }, "auth-button-secondary");
    var policyIdInput = wrapControl("input", { control: "admin-policy-id-input", type: "text" }, "auth-input");
    var policyRulesetInput = wrapControl("input", { control: "admin-policy-ruleset-input", type: "text" }, "auth-input");
    var policyReasonInput = wrapControl("input", { control: "admin-policy-reason-input", type: "text" }, "auth-input");
    var normalizationTargetInput = wrapControl("input", { control: "admin-policy-normalization-target-input", type: "number" }, "auth-input");
    var normalizationToleranceInput = wrapControl("input", { control: "admin-policy-normalization-tolerance-input", type: "number" }, "auth-input");
    var savePolicyBtn = wrapControl("button", { control: "admin-qc-save-policy", type: "button", tone: "primary" }, "auth-button");
    var newDraftBtn = wrapControl("button", { control: "admin-config-new-draft", type: "button", tone: "secondary" }, "auth-button-secondary");
    var replayJobInput = wrapControl("input", { control: "admin-replay-job-id", type: "text", className: "w-56" }, "auth-input w-56");
    var replayJobBtn = wrapControl("button", { control: "admin-replay-job", type: "button", tone: "secondary" }, "auth-button-secondary");
    var draftTypeInput = wrapControl("input", { control: "admin-draft-type", type: "text" }, "auth-input");
    var draftJson = wrapControl("textarea", { control: "admin-draft-json", className: "min-h-40 font-mono text-xs" }, "auth-input min-h-40 font-mono text-xs");
    var draftCancelBtn = wrapControl("button", { control: "admin-draft-cancel", type: "button", tone: "secondary" }, "auth-button-secondary");
    var draftSaveBtn = wrapControl("button", { control: "admin-draft-save", type: "button", tone: "secondary" }, "auth-button-secondary");
    return `
<section class="fe-view hidden" data-view="admin-ops" id="view-admin-ops">
  <div class="fe-view-inner fe-page-shell pb-28">
    <header class="fe-view-header items-end gap-4">
      <div>
        <p class="fe-view-eyebrow">Administration</p>
        <h2 class="fe-view-title">Admin Config &amp; Operations</h2>
      </div>
      <span id="admin-policy-version-badge" class="fe-status-chip inline-flex items-center rounded-brand-pill border border-brand-border/60 bg-brand-surface-alt/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-text">Policy v—</span>
    </header>

    <div class="fe-surface">
      <div class="flex flex-wrap gap-2 border-b border-brand-border/60 pb-4">
        <button class="${qcTab.className}" ${qcTab.attrString} data-admin-tab="qc-rules">QC Rules</button>
        <button class="${configsTab.className}" ${configsTab.attrString} data-admin-tab="configs">Configs</button>
        <button class="${integrationsTab.className}" ${integrationsTab.attrString} data-admin-tab="integrations">Integrations</button>
        <button class="${complianceTab.className}" ${complianceTab.attrString} data-admin-tab="compliance">Compliance</button>
      </div>

      <div id="admin-tab-qc-rules" class="mt-5 space-y-4" data-admin-panel="qc-rules">
        <div class="grid grid-cols-1 gap-3 rounded-[16px] border border-brand-border/40 bg-brand-surface/70 px-3 py-3 md:grid-cols-3">
          <div>
            <label class="fe-label" for="admin-policy-id-input">Policy ID</label>
            <input id="admin-policy-id-input" class="${policyIdInput.className}" ${policyIdInput.attrString} placeholder="default-wave2-policy" />
          </div>
          <div>
            <label class="fe-label" for="admin-policy-ruleset-input">Rule Set Version</label>
            <input id="admin-policy-ruleset-input" class="${policyRulesetInput.className}" ${policyRulesetInput.attrString} placeholder="2026.02.wave2-baseline" />
          </div>
          <div class="md:col-span-3">
            <label class="fe-label" for="admin-policy-reason-input">Change Reason</label>
            <input id="admin-policy-reason-input" class="${policyReasonInput.className}" ${policyReasonInput.attrString} placeholder="Why this policy update is needed" />
          </div>
        </div>
        <div class="grid grid-cols-1 gap-3 rounded-[16px] border border-brand-border/40 bg-brand-surface/70 px-3 py-3 md:grid-cols-3">
          <div>
            <label class="fe-label" for="admin-policy-normalization-target-input">Normalization Target (dB)</label>
            <input id="admin-policy-normalization-target-input" class="${normalizationTargetInput.className}" ${normalizationTargetInput.attrString} step="0.1" min="-24" max="0" />
          </div>
          <div>
            <label class="fe-label" for="admin-policy-normalization-tolerance-input">Normalization Tolerance (dB)</label>
            <input id="admin-policy-normalization-tolerance-input" class="${normalizationToleranceInput.className}" ${normalizationToleranceInput.attrString} step="0.1" min="0" max="6" />
          </div>
          <div class="flex items-end">
            <label class="flex items-center gap-2">
              <input id="admin-policy-normalization-strict-input" type="checkbox" class="h-4 w-4 rounded border-brand-border text-brand-accent focus:ring-brand-accent" />
              <span class="auth-subtle">Strict Enforcement</span>
            </label>
          </div>
        </div>
        <div class="fe-table-shell">
          <table class="fe-table">
            <thead>
              <tr>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Rule ID</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Title</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Severity</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Enabled</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Blocking</th>
              </tr>
            </thead>
            <tbody id="admin-qc-rules-body"></tbody>
          </table>
        </div>
      </div>

      <div id="admin-tab-configs" class="mt-5 hidden space-y-3" data-admin-panel="configs">
        <div class="mb-3">
          <button id="admin-config-new-draft" class="${newDraftBtn.className}" ${newDraftBtn.attrString}>New Draft</button>
        </div>
        <div class="fe-table-shell">
          <table class="fe-table">
            <thead>
              <tr>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Type</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Version</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Published By</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Published At</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Status</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Action</th>
              </tr>
            </thead>
            <tbody id="admin-configs-body"></tbody>
          </table>
        </div>
        <p id="admin-config-feedback" class="auth-subtle mt-3"></p>
      </div>

      <div id="admin-tab-integrations" class="mt-5 hidden space-y-4" data-admin-panel="integrations">
        <div class="fe-table-shell">
          <table class="fe-table">
            <thead>
              <tr>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Provider</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Credential</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Latency</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Status Class</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Recommended Action</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Operator Guidance</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Last Failure</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Action</th>
              </tr>
            </thead>
            <tbody id="admin-integrations-body"></tbody>
          </table>
        </div>
        <p id="admin-integration-feedback" class="auth-subtle mt-3"></p>
        <div id="admin-integration-setup-card" class="hidden rounded-[16px] border border-brand-border/40 bg-brand-surface/70 p-3">
          <div class="flex items-center justify-between gap-2">
            <h3 id="admin-integration-setup-title" class="fe-card-title">Integration Setup</h3>
            <button id="admin-integration-setup-cancel" type="button" class="auth-button-secondary">Close</button>
          </div>
          <div id="admin-integration-setup-fields" class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2"></div>
          <div class="mt-3 flex items-center gap-2">
            <button id="admin-integration-setup-save" type="button" class="auth-button">Save Credentials</button>
            <button id="admin-integration-setup-test" type="button" class="auth-button-secondary">Save &amp; Test</button>
          </div>
          <p id="admin-integration-setup-feedback" class="auth-subtle mt-2"></p>
        </div>

        <div class="fe-surface-muted">
          <p class="fe-label">Replay Failed Job (High Risk)</p>
          <p class="auth-subtle mb-2">Use only after checking failure context. You must provide reason and confirmation.</p>
          <div class="flex flex-wrap items-center gap-2">
            <input id="admin-replay-job-id" class="${replayJobInput.className}" ${replayJobInput.attrString} placeholder="job:<id>" />
            <button id="admin-replay-job" class="${replayJobBtn.className}" ${replayJobBtn.attrString}>Replay Job</button>
          </div>
          <p id="admin-replay-feedback" class="auth-subtle mt-2"></p>
        </div>

        <div class="mt-4">
          <h3 class="fe-card-title">Change History</h3>
          <div class="fe-table-shell mt-2">
            <table class="fe-table">
              <thead>
                <tr>
                  <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Action</th>
                  <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Entity</th>
                  <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Actor</th>
                  <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Reason</th>
                  <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Timestamp</th>
                </tr>
              </thead>
              <tbody id="admin-ops-history-body"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="admin-tab-compliance" class="mt-5 hidden space-y-4" data-admin-panel="compliance">
        <div class="grid grid-cols-1 gap-3 rounded-[16px] border border-brand-border/40 bg-brand-surface/70 px-3 py-3 md:grid-cols-6">
          <div class="md:col-span-2">
            <label class="fe-label" for="admin-compliance-action">Action Filter</label>
            <input id="admin-compliance-action" class="auth-input" placeholder="desktop.ipc.denied.v1" />
          </div>
          <div class="md:col-span-2">
            <label class="fe-label" for="admin-compliance-entity-id">Entity ID Filter</label>
            <input id="admin-compliance-entity-id" class="auth-input" placeholder="submission-id or channel" />
          </div>
          <div>
            <label class="fe-label" for="admin-compliance-limit">Limit</label>
            <input id="admin-compliance-limit" class="auth-input" type="number" min="1" max="500" value="50" />
          </div>
          <div class="flex items-end gap-2">
            <button id="admin-compliance-refresh" class="auth-button-secondary" type="button">Load Events</button>
            <button id="admin-compliance-export" class="auth-button-secondary" type="button">Export JSON</button>
          </div>
        </div>
        <div class="fe-table-shell">
          <table class="fe-table">
            <thead>
              <tr>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Created At</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Actor</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Action</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Entity</th>
                <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Hash</th>
              </tr>
            </thead>
            <tbody id="admin-compliance-events-body"></tbody>
          </table>
        </div>
        <p id="admin-compliance-feedback" class="auth-subtle"></p>
        <textarea id="admin-compliance-export-content" class="auth-input min-h-32 font-mono text-xs" readonly placeholder="Export preview will appear here."></textarea>
      </div>
    </div>
  </div>

  <div
    id="admin-save-policy-dock"
    class="fixed bottom-4 left-4 z-40 hidden"
  >
    <div class="flex items-center gap-2">
      <button id="admin-qc-save-policy" class="${savePolicyBtn.className}" ${savePolicyBtn.attrString}>Save Policy</button>
      <span id="admin-qc-feedback" class="auth-subtle"></span>
    </div>
  </div>

  <dialog id="admin-config-dialog" class="rounded-brand-sm border border-brand-border bg-brand-bg p-0 shadow-brand-md w-[min(680px,92vw)]">
    <form method="dialog" class="p-5 space-y-3">
      <h3 class="fe-card-title">New Config Draft</h3>
      <div>
        <label class="fe-label" for="admin-draft-type">Config Type</label>
        <input id="admin-draft-type" class="${draftTypeInput.className}" ${draftTypeInput.attrString} value="qc_policy" />
      </div>
      <div>
        <label class="fe-label" for="admin-draft-json">Payload JSON</label>
        <textarea id="admin-draft-json" class="${draftJson.className}" ${draftJson.attrString} spellcheck="false">{}</textarea>
      </div>
      <p id="admin-draft-feedback" class="auth-subtle"></p>
      <div class="flex justify-end gap-2">
        <button id="admin-draft-cancel" class="${draftCancelBtn.className}" ${draftCancelBtn.attrString}>Cancel</button>
        <button id="admin-draft-save" class="${draftSaveBtn.className}" ${draftSaveBtn.attrString}>Create Draft</button>
      </div>
    </form>
  </dialog>
</section>`;
  }

  function setActor(actor) {
    if (!actor) {
      return;
    }
    var prevActorId = state.actorId;
    var prevActorRole = state.actorRole;
    if (typeof actor.id === "string" && actor.id.trim()) {
      state.actorId = actor.id.trim();
    }
    if (Array.isArray(actor.roles) && actor.roles.length > 0) {
      if (actor.roles.includes("admin")) {
        state.actorRole = "admin";
      } else if (actor.roles.includes("reviewer")) {
        state.actorRole = "reviewer";
      } else {
        state.actorRole = "creator";
      }
    }
    if (prevActorId !== state.actorId || prevActorRole !== state.actorRole) {
      state.hasAppliedAdminBlockingDefault = false;
    }
    if (!state.isWired) {
      return;
    }
    if (prevActorId === state.actorId && prevActorRole === state.actorRole) {
      return;
    }
    if (!hasAdminContext()) {
      setFeedback("admin-qc-feedback", "Admin access required.");
      setFeedback("admin-config-feedback", "Admin access required.");
      setFeedback("admin-integration-feedback", "Admin access required.");
      setFeedback("admin-compliance-feedback", "Admin access required.");
      return;
    }
    Promise.all([loadPolicy(), loadConfigs(), loadIntegrationHealth(), loadOpsHistory(), loadComplianceEvents()]).catch(function (error) {
      logAdminPageError("refresh-after-actor-change", error);
    });
  }

  function getActorPayload() {
    return {
      actorId: state.actorId,
      actorRole: state.actorRole,
    };
  }

  function setFeedback(id, message) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = message || "";
    }
  }

  function setBusy(id, isBusy, busyLabel) {
    var el = document.getElementById(id);
    if (!el) {
      return;
    }
    el.disabled = Boolean(isBusy);
    if (isBusy) {
      el.dataset.originalText = el.textContent;
      el.textContent = busyLabel || "Working…";
      return;
    }
    if (el.dataset.originalText) {
      el.textContent = el.dataset.originalText;
    }
  }

  function setActiveTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll("[data-admin-panel]").forEach(function (panel) {
      panel.classList.toggle("hidden", panel.dataset.adminPanel !== tabName);
    });
    document.querySelectorAll("[data-admin-tab]").forEach(function (button) {
      if (button.dataset.adminTab === tabName) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    });
    var saveDock = document.getElementById("admin-save-policy-dock");
    if (saveDock) {
      saveDock.classList.toggle("hidden", tabName !== "qc-rules");
    }
  }

  function renderPolicyVersion() {
    var badge = document.getElementById("admin-policy-version-badge");
    if (!badge) {
      return;
    }
    var version = state.policy && state.policy.policyVersion ? state.policy.policyVersion : "—";
    badge.textContent = "Policy v" + version;
  }

  function renderQcRules() {
    var body = document.getElementById("admin-qc-rules-body");
    if (!body) {
      return;
    }
    if (!Array.isArray(state.rules) || state.rules.length === 0) {
      body.innerHTML = '<tr><td class="fe-td-empty bg-brand-surface-alt/40" colspan="5">No rules available.</td></tr>';
      return;
    }
    body.innerHTML = state.rules
      .map(function (rule, index) {
        var uiId = rule && rule.ruleId ? rule.ruleId : String(index);
        return (
          '<tr class="border-b border-brand-border/50 odd:bg-brand-surface-alt/60">' +
          '<td class="fe-td font-mono text-xs">' + rule.ruleId + "</td>" +
          '<td class="fe-td">' + rule.title + "</td>" +
          '<td class="fe-td"><span class="fe-status-chip inline-flex items-center rounded-brand-pill border border-brand-border/60 bg-brand-surface-alt/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-text">' + rule.severity + "</span></td>" +
          '<td class="fe-td"><input data-rule-index="' + index + '" data-field="enabled" data-ui-control="admin-rule-enabled" data-ui-id="' + uiId + '" type="checkbox" class="h-4 w-4 rounded border-brand-border text-brand-accent focus:ring-brand-accent" ' + (rule.enabled ? "checked" : "") + " /></td>" +
          '<td class="fe-td"><input data-rule-index="' + index + '" data-field="blocking" data-ui-control="admin-rule-blocking" data-ui-id="' + uiId + '" type="checkbox" class="h-4 w-4 rounded border-brand-border text-brand-accent focus:ring-brand-accent" ' + (rule.blocking ? "checked" : "") + " /></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderPolicyDraft() {
    var policyIdInput = document.getElementById("admin-policy-id-input");
    if (policyIdInput) {
      policyIdInput.value = state.policyDraft.policyId || "";
    }
    var ruleSetInput = document.getElementById("admin-policy-ruleset-input");
    if (ruleSetInput) {
      ruleSetInput.value = state.policyDraft.ruleSetVersion || "";
    }
    var reasonInput = document.getElementById("admin-policy-reason-input");
    if (reasonInput) {
      reasonInput.value = state.policyDraft.reason || "";
    }
    var normalizationTargetInput = document.getElementById("admin-policy-normalization-target-input");
    if (normalizationTargetInput) {
      normalizationTargetInput.value = state.policyDraft.normalizationTargetDb || "-1.0";
    }
    var normalizationToleranceInput = document.getElementById("admin-policy-normalization-tolerance-input");
    if (normalizationToleranceInput) {
      normalizationToleranceInput.value = state.policyDraft.normalizationToleranceDb || "0.7";
    }
    var normalizationStrictInput = document.getElementById("admin-policy-normalization-strict-input");
    if (normalizationStrictInput) {
      normalizationStrictInput.checked = Boolean(state.policyDraft.normalizationStrict);
    }
  }

  function extractNormalizationSettingsFromRules(rules) {
    if (!Array.isArray(rules)) {
      return;
    }
    var normalizationRuleIds = [
      "DEMO_NORMALIZATION_INVALID",
      "PRESET_PREVIEW_NORMALIZATION_INVALID",
      "MIDI_PREVIEW_NORMALIZATION_INVALID",
    ];
    var matched = null;
    for (var index = 0; index < rules.length; index += 1) {
      var rule = rules[index];
      if (!rule || normalizationRuleIds.indexOf(rule.ruleId) === -1) {
        continue;
      }
      if (rule.params && typeof rule.params === "object") {
        matched = rule.params;
        break;
      }
    }
    if (!matched) {
      return;
    }
    if (typeof matched.target_peak_db === "number" && Number.isFinite(matched.target_peak_db)) {
      state.policyDraft.normalizationTargetDb = String(matched.target_peak_db);
    }
    if (typeof matched.tolerance_db === "number" && Number.isFinite(matched.tolerance_db)) {
      state.policyDraft.normalizationToleranceDb = String(matched.tolerance_db);
    }
    if (typeof matched.strict_enforcement === "boolean") {
      state.policyDraft.normalizationStrict = matched.strict_enforcement;
    }
  }

  function buildRuleParams(ruleId) {
    var normalizationRuleIds = [
      "DEMO_NORMALIZATION_INVALID",
      "PRESET_PREVIEW_NORMALIZATION_INVALID",
      "MIDI_PREVIEW_NORMALIZATION_INVALID",
    ];
    if (normalizationRuleIds.indexOf(ruleId) === -1) {
      return {};
    }
    var targetPeakDb = Number(state.policyDraft.normalizationTargetDb);
    var toleranceDb = Number(state.policyDraft.normalizationToleranceDb);
    if (!Number.isFinite(targetPeakDb)) {
      targetPeakDb = -1.0;
    }
    if (!Number.isFinite(toleranceDb) || toleranceDb < 0) {
      toleranceDb = 0.7;
    }
    return {
      target_peak_db: targetPeakDb,
      tolerance_db: toleranceDb,
      strict_enforcement: Boolean(state.policyDraft.normalizationStrict),
    };
  }

  function renderConfigs() {
    var body = document.getElementById("admin-configs-body");
    if (!body) {
      return;
    }
    if (!Array.isArray(state.configs) || state.configs.length === 0) {
      body.innerHTML = '<tr><td class="fe-td-empty bg-brand-surface-alt/40" colspan="6">No configs found.</td></tr>';
      return;
    }
    body.innerHTML = state.configs
      .map(function (config) {
        var statusLabel = config.isDraft ? "draft" : "published";
        var publishBtn = wrapControl("button", {
          control: "admin-config-publish",
          type: "button",
          tone: "secondary",
          uiId: config.id,
        }, "auth-button-secondary");
        var publishAttrs = publishBtn.attrString + (config.isDraft ? "" : ' disabled aria-disabled="true"');
        var publishData = config.isDraft ? ' data-config-publish="' + config.id + '"' : "";
        var publishLabel = config.isDraft ? "Publish" : "Published";
        var publishButton = '<button class="' + publishBtn.className + '" ' + publishAttrs + publishData + ">" + publishLabel + "</button>";
        var rollbackBtn = wrapControl("button", {
          control: "admin-config-rollback",
          type: "button",
          tone: "secondary",
          uiId: config.id,
        }, "auth-button-secondary");
        var rollbackAttrs = rollbackBtn.attrString + (config.isDraft ? ' disabled aria-disabled="true"' : "");
        var rollbackData = config.isDraft ? "" : ' data-config-rollback="' + config.id + '"';
        var rollbackButton = '<button class="' + rollbackBtn.className + '" ' + rollbackAttrs + rollbackData + ">Rollback</button>";
        return (
          '<tr class="border-b border-brand-border/50 odd:bg-brand-surface-alt/60">' +
          '<td class="fe-td">' + config.configType + "</td>" +
          '<td class="fe-td">v' + config.version + "</td>" +
          '<td class="fe-td">' + (config.publishedBy || "—") + "</td>" +
          '<td class="fe-td">' + (config.publishedAt ? new Date(config.publishedAt).toLocaleString() : "—") + "</td>" +
          '<td class="fe-td"><span class="fe-status-chip inline-flex items-center rounded-brand-pill border border-brand-border/60 bg-brand-surface-alt/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-text">' + statusLabel + "</span></td>" +
          '<td class="fe-td"><div class="flex flex-wrap gap-1">' + publishButton + rollbackButton + "</div></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderIntegrations() {
    var body = document.getElementById("admin-integrations-body");
    if (!body) {
      return;
    }
    var providers = ["dropbox", "airtable", "smtp"];
    body.innerHTML = providers
      .map(function (provider) {
        var item = state.integrationHealth[provider];
        if (!item) {
          item = {
            provider: provider,
            credentialStatus: "unknown",
            latencyMs: 0,
            statusClass: "unknown",
            recommendedAction: "run_connection_test",
            statusCopy: "Run a connection test to load health state.",
            lastFailureContext: "—",
          };
        }
        var latency = item.latencyMs > 0 ? item.latencyMs + " ms" : "—";
        var testBtn = wrapControl("button", {
          control: "admin-integration-test",
          type: "button",
          tone: "secondary",
          uiId: provider,
        }, "auth-button-secondary");
        var setupBtn = wrapControl("button", {
          control: "admin-integration-setup",
          type: "button",
          tone: "secondary",
          uiId: provider,
        }, "auth-button-secondary");
        return (
          '<tr class="border-b border-brand-border/50 odd:bg-brand-surface-alt/60">' +
          '<td class="fe-td">' + provider.toUpperCase() + "</td>" +
          '<td class="fe-td">' + item.credentialStatus + "</td>" +
          '<td class="fe-td">' + latency + "</td>" +
          '<td class="fe-td"><span class="fe-status-chip inline-flex items-center rounded-brand-pill border border-brand-border/60 bg-brand-surface-alt/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-text">' + item.statusClass + "</span></td>" +
          '<td class="fe-td">' + item.recommendedAction + "</td>" +
          '<td class="fe-td">' + item.statusCopy + "</td>" +
          '<td class="fe-td">' + (item.lastFailureContext || "—") + "</td>" +
          '<td class="fe-td flex flex-wrap gap-1">' +
          '<button class="' + testBtn.className + '" ' + testBtn.attrString + ' data-integration-test="' + provider + '">Test</button>' +
          '<button class="' + setupBtn.className + '" ' + setupBtn.attrString + ' data-integration-setup="' + provider + '">Setup</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderOpsHistory() {
    var body = document.getElementById("admin-ops-history-body");
    if (!body) {
      return;
    }
    if (!Array.isArray(state.opsHistory) || state.opsHistory.length === 0) {
      body.innerHTML = '<tr><td class="fe-td-empty bg-brand-surface-alt/40" colspan="5">No operational history found.</td></tr>';
      return;
    }
    body.innerHTML = state.opsHistory
      .map(function (entry) {
        return (
          '<tr class="border-b border-brand-border/50 odd:bg-brand-surface-alt/60">' +
          '<td class="fe-td font-mono text-xs">' + entry.action + "</td>" +
          '<td class="fe-td">' + entry.entity + "</td>" +
          '<td class="fe-td">' + (entry.actorId || "system") + "</td>" +
          '<td class="fe-td">' + (entry.reason || "—") + "</td>" +
          '<td class="fe-td">' + (entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—") + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderComplianceEvents() {
    var body = document.getElementById("admin-compliance-events-body");
    if (!body) {
      return;
    }
    if (!Array.isArray(state.complianceEvents) || state.complianceEvents.length === 0) {
      body.innerHTML = '<tr><td class="fe-td-empty bg-brand-surface-alt/40" colspan="5">No audit events found for current filters.</td></tr>';
      return;
    }
    body.innerHTML = state.complianceEvents
      .map(function (event) {
        var createdAt = event.createdAt ? new Date(event.createdAt).toLocaleString() : "—";
        var actorId = event.actorId || "system";
        var entity = (event.entityType || "—") + ":" + (event.entityId || "—");
        var shortHash = event.eventHash ? String(event.eventHash).slice(0, 12) + "…" : "—";
        return (
          '<tr class="border-b border-brand-border/50 odd:bg-brand-surface-alt/60">' +
          '<td class="fe-td">' + createdAt + "</td>" +
          '<td class="fe-td">' + actorId + "</td>" +
          '<td class="fe-td font-mono text-xs">' + (event.action || "—") + "</td>" +
          '<td class="fe-td">' + entity + "</td>" +
          '<td class="fe-td font-mono text-xs" title="' + (event.eventHash || "") + '">' + shortHash + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function readComplianceFilters() {
    var action = document.getElementById("admin-compliance-action")?.value || "";
    var entityId = document.getElementById("admin-compliance-entity-id")?.value || "";
    var limitRaw = document.getElementById("admin-compliance-limit")?.value || "50";
    var limit = Number(limitRaw);
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = 50;
    }
    if (limit > 500) {
      limit = 500;
    }
    return {
      action: action.trim() || null,
      entityId: entityId.trim() || null,
      limit: Math.trunc(limit),
    };
  }

  async function loadPolicy() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.qcPolicy) {
      setFeedback("admin-qc-feedback", "Admin policy API unavailable.");
      return;
    }
    var policyResponse = await desktopApi.admin.qcPolicy.get(getActorPayload());
    if (!policyResponse.ok) {
      setFeedback("admin-qc-feedback", policyResponse.error.message || "Failed to load policy.");
      return;
    }
    var rulesResponse = await desktopApi.qc.listRules({ includeDisabled: true });
    if (!rulesResponse.ok) {
      setFeedback("admin-qc-feedback", rulesResponse.error.message || "Failed to load rules.");
      return;
    }
    state.policy = policyResponse.data.policy;
    state.policyDraft.policyId = (state.policy && state.policy.policyId) || "";
    state.policyDraft.ruleSetVersion = (state.policy && state.policy.ruleSetVersion) || "";
    state.policyDraft.reason = "";
    extractNormalizationSettingsFromRules(state.policy && state.policy.rules);
    state.rules = Array.isArray(rulesResponse.data.rules) ? rulesResponse.data.rules.slice() : [];
    if (state.actorRole === "admin" && !state.hasAppliedAdminBlockingDefault) {
      state.rules = state.rules.map(function (rule) {
        if (!rule) {
          return rule;
        }
        return Object.assign({}, rule, { blocking: false });
      });
      state.hasAppliedAdminBlockingDefault = true;
    }
    renderPolicyVersion();
    renderPolicyDraft();
    renderQcRules();
    setFeedback("admin-qc-feedback", "");
  }

  async function loadConfigs() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.configs) {
      setFeedback("admin-config-feedback", "Admin configs API unavailable.");
      return;
    }
    var response = await desktopApi.admin.configs.list({
      actorId: state.actorId,
      actorRole: state.actorRole,
      includeDrafts: true,
    });
    if (!response.ok) {
      setFeedback("admin-config-feedback", response.error.message || "Failed to load configs.");
      return;
    }
    state.configs = Array.isArray(response.data.configs) ? response.data.configs.slice() : [];
    renderConfigs();
  }

  async function loadIntegrationHealth() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.integrations) {
      return;
    }
    var response = await desktopApi.admin.integrations.listHealth(getActorPayload());
    if (!response.ok) {
      setFeedback("admin-integration-feedback", response.error.message || "Failed to load integration health.");
      return;
    }
    var next = {
      dropbox: null,
      airtable: null,
      smtp: null,
    };
    (response.data.integrations || []).forEach(function (item) {
      next[item.provider] = item;
    });
    state.integrationHealth = next;
    renderIntegrations();
  }

  async function loadOpsHistory() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.ops) {
      return;
    }
    var response = await desktopApi.admin.ops.listHistory({
      actorId: state.actorId,
      actorRole: state.actorRole,
      limit: 20,
    });
    if (!response.ok) {
      setFeedback("admin-integration-feedback", response.error.message || "Failed to load change history.");
      return;
    }
    state.opsHistory = Array.isArray(response.data.entries) ? response.data.entries.slice() : [];
    renderOpsHistory();
  }

  async function loadComplianceEvents() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.audit || typeof desktopApi.audit.listEvents !== "function") {
      setFeedback("admin-compliance-feedback", "Compliance audit API unavailable.");
      return;
    }
    var filters = readComplianceFilters();
    var response = await desktopApi.audit.listEvents({
      actorId: state.actorId,
      actorRole: state.actorRole,
      action: filters.action,
      entityType: null,
      entityId: filters.entityId,
      from: null,
      to: null,
      limit: filters.limit,
      offset: 0,
    });
    if (!response.ok) {
      setFeedback("admin-compliance-feedback", response.error.message || "Failed to load audit events.");
      return;
    }
    state.complianceEvents = Array.isArray(response.data.events) ? response.data.events.slice() : [];
    renderComplianceEvents();
    setFeedback("admin-compliance-feedback", "Loaded " + state.complianceEvents.length + " audit events.");
  }

  async function exportComplianceEvents() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.audit || typeof desktopApi.audit.exportEvents !== "function") {
      setFeedback("admin-compliance-feedback", "Compliance export API unavailable.");
      return;
    }
    var filters = readComplianceFilters();
    var response = await desktopApi.audit.exportEvents({
      actorId: state.actorId,
      actorRole: state.actorRole,
      format: "json",
      includeHashChain: true,
      action: filters.action,
      entityType: null,
      entityId: filters.entityId,
      from: null,
      to: null,
      limit: filters.limit,
    });
    if (!response.ok) {
      setFeedback("admin-compliance-feedback", response.error.message || "Failed to export audit events.");
      return;
    }
    state.complianceExport = response.data;
    var output = document.getElementById("admin-compliance-export-content");
    if (output) {
      output.value = response.data.content || "";
    }
    setFeedback(
      "admin-compliance-feedback",
      "Export ready (" + response.data.format + ", signature " + response.data.signatureAlgorithm + ")."
    );
  }

  async function savePolicy() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.qcPolicy || !state.policy) {
      return;
    }
    setBusy("admin-qc-save-policy", true, "Saving…");
    try {
      var response = await desktopApi.admin.qcPolicy.update({
        requestId: "admin-policy-" + Date.now(),
        actorId: state.actorId,
        actorRole: state.actorRole,
        reason: state.policyDraft.reason || "Admin policy update from desktop admin page",
        expectedPolicyVersion: state.policy.policyVersion,
        policy: {
          policyId: state.policyDraft.policyId || state.policy.policyId,
          ruleSetVersion: state.policyDraft.ruleSetVersion || state.policy.ruleSetVersion || null,
          rules: state.rules.map(function (rule) {
            return {
              ruleId: rule.ruleId,
              enabled: Boolean(rule.enabled),
              blockingOverride: Boolean(rule.blocking),
              params: buildRuleParams(rule.ruleId),
            };
          }),
        },
      });
      if (!response.ok) {
        setFeedback("admin-qc-feedback", response.error.message || "Failed to save policy.");
        return;
      }
      state.policy = response.data.policy;
      state.policyDraft.policyId = (state.policy && state.policy.policyId) || state.policyDraft.policyId;
      state.policyDraft.ruleSetVersion = (state.policy && state.policy.ruleSetVersion) || state.policyDraft.ruleSetVersion;
      state.policyDraft.reason = "";
      renderPolicyVersion();
      renderPolicyDraft();
      setFeedback("admin-qc-feedback", "Policy saved to version " + response.data.policy.policyVersion + ".");
    } finally {
      setBusy("admin-qc-save-policy", false);
    }
  }

  function openDraftDialog() {
    var dialog = document.getElementById("admin-config-dialog");
    setFeedback("admin-draft-feedback", "");
    if (!dialog) {
      return;
    }
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      return;
    }
    dialog.setAttribute("open", "open");
  }

  function closeDraftDialog() {
    var dialog = document.getElementById("admin-config-dialog");
    if (!dialog) {
      return;
    }
    if (typeof dialog.close === "function") {
      dialog.close();
      return;
    }
    dialog.removeAttribute("open");
  }

  async function createDraft() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.configs) {
      return;
    }
    var typeInput = document.getElementById("admin-draft-type");
    var jsonInput = document.getElementById("admin-draft-json");
    var configType = typeInput ? typeInput.value.trim() : "";
    var payloadRaw = jsonInput ? jsonInput.value : "{}";
    var parsedPayload;
    try {
      parsedPayload = JSON.parse(payloadRaw);
    } catch (error) {
      setFeedback("admin-draft-feedback", "Invalid JSON payload: " + error.message);
      return;
    }

    setBusy("admin-draft-save", true, "Creating…");
    try {
      var response = await desktopApi.admin.configs.createDraft({
        actorId: state.actorId,
        actorRole: state.actorRole,
        configType: configType,
        payloadJson: parsedPayload,
      });
      if (!response.ok) {
        setFeedback("admin-draft-feedback", response.error.message || "Failed to create draft.");
        return;
      }
      closeDraftDialog();
      setFeedback("admin-config-feedback", "Draft created: " + response.data.config.id);
      await loadConfigs();
    } finally {
      setBusy("admin-draft-save", false);
    }
  }

  async function publishConfig(configId) {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.configs) {
      return;
    }
    var intent = runHighRiskConfirmation({
      token: "PUBLISH",
      reasonPrompt: "Why are you publishing this config?",
      confirmPrompt: "Type PUBLISH to confirm.",
      defaultReason: "Publish validated draft",
    });
    if (!intent) {
      setFeedback("admin-config-feedback", "Publish canceled: explicit reason and confirmation are required.");
      return;
    }

    var response = await desktopApi.admin.configs.publish({
      id: configId,
      actorId: state.actorId,
      actorRole: state.actorRole,
      reason: intent.reason,
      confirmation: intent.confirmation,
    });
    if (!response.ok) {
      setFeedback("admin-config-feedback", response.error.message || "Failed to publish config.");
      return;
    }
    setFeedback("admin-config-feedback", "Published " + configId + " as v" + response.data.config.version + ".");
    await loadConfigs();
    await loadOpsHistory();
  }

  async function rollbackConfig(configId) {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.configs) {
      return;
    }
    var intent = runHighRiskConfirmation({
      token: "ROLLBACK",
      reasonPrompt: "Why are you rolling back this config?",
      confirmPrompt: "Type ROLLBACK to confirm.",
      defaultReason: "Rollback unsafe config change",
    });
    if (!intent) {
      setFeedback("admin-config-feedback", "Rollback canceled: explicit reason and confirmation are required.");
      return;
    }

    var response = await desktopApi.admin.configs.rollback({
      id: configId,
      actorId: state.actorId,
      actorRole: state.actorRole,
      reason: intent.reason,
      confirmation: intent.confirmation,
    });
    if (!response.ok) {
      setFeedback("admin-config-feedback", response.error.message || "Failed to rollback config.");
      return;
    }
    setFeedback("admin-config-feedback", "Rolled back " + configId + " to v" + response.data.config.version + ".");
    await loadConfigs();
    await loadOpsHistory();
  }

  async function testIntegration(provider) {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.integrations) {
      return;
    }
    var response = await desktopApi.admin.integrations.test({
      provider: provider,
      actorId: state.actorId,
      actorRole: state.actorRole,
    });
    if (!response.ok) {
      setFeedback("admin-integration-feedback", response.error.message || "Connection test failed.");
      return;
    }
    state.integrationHealth[provider] = response.data;
    setFeedback("admin-integration-feedback", provider.toUpperCase() + ": " + response.data.statusCopy);
    renderIntegrations();
  }

  function closeIntegrationSetup() {
    var card = document.getElementById("admin-integration-setup-card");
    if (!card) {
      return;
    }
    card.classList.add("hidden");
    card.removeAttribute("data-provider");
    card.removeAttribute("data-dropbox-mode");
    setFeedback("admin-integration-setup-feedback", "");
  }

  async function startDropboxReconnectFlow(desktopApi) {
    var startResponse = await desktopApi.admin.integrations.startDropboxOauthDesktop({
      actorId: state.actorId,
      actorRole: state.actorRole,
      appKey: null,
    });
    if (!startResponse || !startResponse.ok) {
      setFeedback("admin-integration-feedback", startResponse?.error?.message || "Failed to start Dropbox OAuth.");
      return;
    }
    setFeedback("admin-integration-feedback", "Dropbox login opened in browser. Complete auth to reconnect.");
    var sessionId = startResponse.data?.sessionId || "";
    if (!sessionId || !desktopApi.admin.integrations.getDropboxOauthDesktopStatus) {
      return;
    }
    for (var i = 0; i < 60; i += 1) {
      await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      var statusResponse = await desktopApi.admin.integrations.getDropboxOauthDesktopStatus({
        actorId: state.actorId,
        actorRole: state.actorRole,
        sessionId: sessionId,
      });
      if (!statusResponse || !statusResponse.ok || !statusResponse.data) {
        continue;
      }
      if (statusResponse.data.status === "pending") {
        continue;
      }
      if (statusResponse.data.status === "completed") {
        setFeedback("admin-integration-feedback", "Dropbox reconnected successfully.");
        await loadIntegrationHealth();
      } else {
        setFeedback("admin-integration-feedback", statusResponse.data.message || "Dropbox reconnect failed.");
      }
      return;
    }
    setFeedback("admin-integration-feedback", "Dropbox reconnect timed out. You can retry Setup.");
  }

  async function openIntegrationSetup(provider) {
    var card = document.getElementById("admin-integration-setup-card");
    var fields = document.getElementById("admin-integration-setup-fields");
    var title = document.getElementById("admin-integration-setup-title");
    if (!card || !fields || !title) {
      return;
    }
    title.textContent = "Setup " + provider.toUpperCase() + " Credentials";
    card.setAttribute("data-provider", provider);
    card.classList.remove("hidden");
    if (provider === "airtable") {
      fields.innerHTML =
        '<div class="md:col-span-2"><label class="fe-label" for="admin-setup-airtable-api-key">Airtable API Key</label><input id="admin-setup-airtable-api-key" type="password" class="auth-input" placeholder="pat..."/></div>' +
        '<div><label class="fe-label" for="admin-setup-airtable-table">Submissions Table (optional)</label><input id="admin-setup-airtable-table" type="text" class="auth-input" placeholder="app.../Submissions"/></div>' +
        '<div><label class="fe-label" for="admin-setup-airtable-view">Completion View (optional)</label><input id="admin-setup-airtable-view" type="text" class="auth-input" placeholder="Desktop Completion Lookup v1"/></div>';
      return;
    }
    if (provider === "smtp") {
      fields.innerHTML =
        '<div><label class="fe-label" for="admin-setup-smtp-host">SMTP Host</label><input id="admin-setup-smtp-host" type="text" class="auth-input" placeholder="smtp.example.com"/></div>' +
        '<div><label class="fe-label" for="admin-setup-smtp-port">SMTP Port</label><input id="admin-setup-smtp-port" type="number" class="auth-input" min="1" max="65535" placeholder="587"/></div>' +
        '<div><label class="fe-label" for="admin-setup-smtp-username">SMTP Username (optional)</label><input id="admin-setup-smtp-username" type="text" class="auth-input" placeholder="username"/></div>' +
        '<div><label class="fe-label" for="admin-setup-smtp-password">SMTP Password (optional)</label><input id="admin-setup-smtp-password" type="password" class="auth-input" placeholder="password"/></div>' +
        '<div class="md:col-span-2"><label class="fe-label" for="admin-setup-smtp-from-email">From Email (optional)</label><input id="admin-setup-smtp-from-email" type="email" class="auth-input" placeholder="ops@example.com"/></div>';
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.integrations) {
      setFeedback("admin-integration-feedback", "Desktop integrations API unavailable.");
      return;
    }
    var readiness = await desktopApi.admin.integrations.getDropboxReadiness({
      actorId: state.actorId,
      actorRole: state.actorRole,
    });
    var hasAppCredentials = Boolean(readiness?.ok && readiness?.data?.hasAppCredentials);
    if (hasAppCredentials) {
      closeIntegrationSetup();
      await startDropboxReconnectFlow(desktopApi);
      return;
    }
    card.setAttribute("data-dropbox-mode", "app_credentials");
    fields.innerHTML =
      '<div class="md:col-span-2"><label class="fe-label" for="admin-setup-dropbox-app-key">Dropbox App Key</label><input id="admin-setup-dropbox-app-key" type="text" class="auth-input" placeholder="app key"/></div>' +
      '<div class="md:col-span-2"><label class="fe-label" for="admin-setup-dropbox-app-secret">Dropbox App Secret</label><input id="admin-setup-dropbox-app-secret" type="password" class="auth-input" placeholder="app secret"/></div>' +
      '<p class="md:col-span-2 auth-subtle">Save app credentials first. OAuth reconnect will start automatically after save.</p>';
  }

  async function saveIntegrationSetup(runTestAfterSave) {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.admin || !desktopApi.admin.integrations) {
      return;
    }
    var card = document.getElementById("admin-integration-setup-card");
    if (!card) {
      return;
    }
    var provider = card.getAttribute("data-provider");
    if (!provider) {
      return;
    }
    setBusy("admin-integration-setup-save", true, "Saving…");
    setBusy("admin-integration-setup-test", true, "Saving…");
    setFeedback("admin-integration-setup-feedback", "");
    try {
      var configureResponse = null;
      if (provider === "airtable") {
        var apiKey = document.getElementById("admin-setup-airtable-api-key")?.value.trim() || "";
        var tableRef = document.getElementById("admin-setup-airtable-table")?.value.trim() || "";
        var completionView = document.getElementById("admin-setup-airtable-view")?.value.trim() || "";
        if (!apiKey) {
          setFeedback("admin-integration-setup-feedback", "Airtable API key is required.");
          return;
        }
        configureResponse = await desktopApi.admin.integrations.configureAirtable({
          actorId: state.actorId,
          actorRole: state.actorRole,
          apiKey: apiKey,
          submissionsTable: tableRef || null,
          completionView: completionView || null,
        });
      } else if (provider === "smtp") {
        var host = document.getElementById("admin-setup-smtp-host")?.value.trim() || "";
        var portRaw = document.getElementById("admin-setup-smtp-port")?.value.trim() || "";
        var port = Number(portRaw);
        var username = document.getElementById("admin-setup-smtp-username")?.value.trim() || "";
        var password = document.getElementById("admin-setup-smtp-password")?.value || "";
        var fromEmail = document.getElementById("admin-setup-smtp-from-email")?.value.trim() || "";
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
          setFeedback("admin-integration-setup-feedback", "SMTP host and valid port are required.");
          return;
        }
        configureResponse = await desktopApi.admin.integrations.configureSmtp({
          actorId: state.actorId,
          actorRole: state.actorRole,
          host: host,
          port: port,
          username: username || null,
          password: password || null,
          fromEmail: fromEmail || null,
        });
      } else {
        var mode = card.getAttribute("data-dropbox-mode") || "tokens";
        if (mode === "app_credentials") {
          var appKey = document.getElementById("admin-setup-dropbox-app-key")?.value.trim() || "";
          var appSecret = document.getElementById("admin-setup-dropbox-app-secret")?.value.trim() || "";
          if (!appKey || !appSecret) {
            setFeedback("admin-integration-setup-feedback", "Dropbox app key and app secret are required.");
            return;
          }
          configureResponse = await desktopApi.admin.integrations.configureDropboxApp({
            actorId: state.actorId,
            actorRole: state.actorRole,
            appKey: appKey,
            appSecret: appSecret,
          });
        } else {
          var refreshToken = document.getElementById("admin-setup-dropbox-refresh-token")?.value.trim() || "";
          var accessToken = document.getElementById("admin-setup-dropbox-access-token")?.value.trim() || "";
          if (!refreshToken) {
            setFeedback("admin-integration-setup-feedback", "Dropbox refresh token is required.");
            return;
          }
          configureResponse = await desktopApi.admin.integrations.updateDropboxTokens({
            actorId: state.actorId,
            actorRole: state.actorRole,
            refreshToken: refreshToken,
            accessToken: accessToken || null,
          });
        }
      }
      if (!configureResponse || !configureResponse.ok) {
        var message = configureResponse?.error?.message || "Failed to save integration credentials.";
        setFeedback("admin-integration-setup-feedback", message);
        return;
      }
      setFeedback("admin-integration-feedback", provider.toUpperCase() + " credentials saved.");
      setFeedback("admin-integration-setup-feedback", provider.toUpperCase() + " credentials saved.");
      if (provider === "dropbox" && card.getAttribute("data-dropbox-mode") === "app_credentials") {
        closeIntegrationSetup();
        await startDropboxReconnectFlow(desktopApi);
        return;
      }
      if (runTestAfterSave) {
        await testIntegration(provider);
      } else {
        await loadIntegrationHealth();
      }
    } finally {
      setBusy("admin-integration-setup-save", false);
      setBusy("admin-integration-setup-test", false);
    }
  }

  async function replayFailedJob() {
    if (!hasAdminContext()) {
      return;
    }
    var desktopApi = getDesktopApi();
    if (!desktopApi || !desktopApi.jobs) {
      return;
    }
    var input = document.getElementById("admin-replay-job-id");
    var jobId = input ? input.value.trim() : "";
    if (!jobId) {
      setFeedback("admin-replay-feedback", "Enter a failed job ID before replay.");
      return;
    }

    var intent = runHighRiskConfirmation({
      token: "REPLAY",
      reasonPrompt: "Why are you replaying job " + jobId + "?",
      confirmPrompt: "Type REPLAY to confirm.",
      defaultReason: "Recover failed integration job",
    });
    if (!intent) {
      setFeedback("admin-replay-feedback", "Replay canceled: explicit reason and confirmation are required.");
      return;
    }

    setBusy("admin-replay-job", true, "Replaying…");
    try {
      var response = await desktopApi.jobs.replay({
        id: jobId,
        requestId: "admin-replay-" + Date.now(),
        actorId: state.actorId,
        reason: intent.reason,
        confirmation: intent.confirmation,
      });
      if (!response.ok) {
        setFeedback("admin-replay-feedback", response.error.message || "Replay failed.");
        return;
      }
      setFeedback("admin-replay-feedback", "Job replayed and queued: " + response.data.job.id);
      await loadOpsHistory();
    } finally {
      setBusy("admin-replay-job", false);
    }
  }

  function wireInteractions() {
    document.querySelectorAll("[data-admin-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setActiveTab(button.dataset.adminTab);
      });
    });

    document.getElementById("admin-qc-save-policy")?.addEventListener("click", function () {
      savePolicy().catch(function (error) {
        setFeedback("admin-qc-feedback", logAdminPageError("save-policy", error));
      });
    });
    document.getElementById("admin-policy-id-input")?.addEventListener("input", function (event) {
      state.policyDraft.policyId = event.target.value.trim();
    });
    document.getElementById("admin-policy-ruleset-input")?.addEventListener("input", function (event) {
      state.policyDraft.ruleSetVersion = event.target.value.trim();
    });
    document.getElementById("admin-policy-reason-input")?.addEventListener("input", function (event) {
      state.policyDraft.reason = event.target.value.trim();
    });
    document.getElementById("admin-policy-normalization-target-input")?.addEventListener("input", function (event) {
      state.policyDraft.normalizationTargetDb = event.target.value.trim();
    });
    document.getElementById("admin-policy-normalization-tolerance-input")?.addEventListener("input", function (event) {
      state.policyDraft.normalizationToleranceDb = event.target.value.trim();
    });
    document.getElementById("admin-policy-normalization-strict-input")?.addEventListener("change", function (event) {
      state.policyDraft.normalizationStrict = Boolean(event.target.checked);
    });

    document.getElementById("admin-qc-rules-body")?.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || !target.dataset) {
        return;
      }
      var index = Number(target.dataset.ruleIndex);
      var field = target.dataset.field;
      if (!Number.isInteger(index) || !state.rules[index]) {
        return;
      }
      if (field === "enabled") {
        state.rules[index].enabled = Boolean(target.checked);
      }
      if (field === "blocking") {
        state.rules[index].blocking = Boolean(target.checked);
        state.rules[index].severity = target.checked ? "blocking" : "warning";
      }
    });

    document.getElementById("admin-config-new-draft")?.addEventListener("click", openDraftDialog);
    document.getElementById("admin-draft-cancel")?.addEventListener("click", closeDraftDialog);
    document.getElementById("admin-draft-save")?.addEventListener("click", function () {
      createDraft().catch(function (error) {
        setFeedback("admin-draft-feedback", logAdminPageError("create-draft", error));
      });
    });
    document.getElementById("admin-configs-body")?.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.dataset || !target.dataset.configPublish) {
        if (!target || !target.dataset || !target.dataset.configRollback) {
          return;
        }
        return rollbackConfig(target.dataset.configRollback).catch(function (error) {
          setFeedback("admin-config-feedback", logAdminPageError("rollback-config", error));
        });
      }
      return publishConfig(target.dataset.configPublish).catch(function (error) {
        setFeedback("admin-config-feedback", logAdminPageError("publish-config", error));
      });
    });

    document.getElementById("admin-integrations-body")?.addEventListener("click", function (event) {
      var target = event.target;
      if (!target || !target.dataset) {
        return;
      }
      if (target.dataset.integrationTest) {
        testIntegration(target.dataset.integrationTest).catch(function (error) {
          setFeedback("admin-integration-feedback", logAdminPageError("test-integration", error));
        });
        return;
      }
      if (target.dataset.integrationSetup) {
        openIntegrationSetup(target.dataset.integrationSetup).catch(function (error) {
          setFeedback("admin-integration-feedback", logAdminPageError("open-integration-setup", error));
        });
      }
    });
    document.getElementById("admin-integration-setup-cancel")?.addEventListener("click", function () {
      closeIntegrationSetup();
    });
    document.getElementById("admin-integration-setup-save")?.addEventListener("click", function () {
      saveIntegrationSetup(false).catch(function (error) {
        setFeedback("admin-integration-setup-feedback", logAdminPageError("save-integration-setup", error));
      });
    });
    document.getElementById("admin-integration-setup-test")?.addEventListener("click", function () {
      saveIntegrationSetup(true).catch(function (error) {
        setFeedback("admin-integration-setup-feedback", logAdminPageError("save-and-test-integration-setup", error));
      });
    });

    document.getElementById("admin-replay-job")?.addEventListener("click", function () {
      replayFailedJob().catch(function (error) {
        setFeedback("admin-replay-feedback", logAdminPageError("replay-job", error));
      });
    });
    document.getElementById("admin-compliance-refresh")?.addEventListener("click", function () {
      loadComplianceEvents().catch(function (error) {
        setFeedback("admin-compliance-feedback", logAdminPageError("load-compliance", error));
      });
    });
    document.getElementById("admin-compliance-export")?.addEventListener("click", function () {
      exportComplianceEvents().catch(function (error) {
        setFeedback("admin-compliance-feedback", logAdminPageError("export-compliance", error));
      });
    });
  }

  async function wire() {
    setActiveTab(state.activeTab);
    wireInteractions();
    state.isWired = true;
    if (!hasAdminContext()) {
      setFeedback("admin-qc-feedback", "Admin access required.");
      setFeedback("admin-config-feedback", "Admin access required.");
      setFeedback("admin-integration-feedback", "Admin access required.");
      setFeedback("admin-compliance-feedback", "Admin access required.");
      return;
    }
    await loadPolicy();
    await loadConfigs();
    await loadIntegrationHealth();
    await loadOpsHistory();
    await loadComplianceEvents();
  }

  return {
    getTemplate: getTemplate,
    wire: wire,
    setActor: setActor,
  };
});
