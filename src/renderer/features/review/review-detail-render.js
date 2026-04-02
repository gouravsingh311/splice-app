/* Review Detail render helpers for PRD-08 decision flow. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewDetailRender = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createReviewDetailRender(ctx) {
    function getDocument() {
      return typeof ctx.getDocument === "function" ? ctx.getDocument() : null;
    }

    function setText(id, value) {
      var doc = getDocument();
      var el = doc && doc.getElementById ? doc.getElementById(id) : null;
      if (el) {
        el.textContent = value == null ? "—" : String(value);
      }
    }

    function showFeedback(message, tone) {
      var doc = getDocument();
      var el = doc && doc.getElementById ? doc.getElementById("review-detail-feedback") : null;
      if (!el) {
        return;
      }
      if (!message) {
        el.textContent = "";
        el.className = "auth-feedback hidden";
        return;
      }
      el.textContent = message;
      el.className = "auth-feedback " + (tone || "");
    }

    function showToast(message, tone) {
      var doc = getDocument();
      var root = doc && doc.getElementById ? doc.getElementById("review-toast") : null;
      if (!root) {
        return;
      }
      root.textContent = message;
      root.className = "fixed bottom-6 right-6 z-50 px-4 py-2 rounded-brand-sm border bg-brand-surface text-brand-text shadow-brand-sm " +
        (tone === "error" ? "border-brand-danger" : "border-brand-border");
      setTimeout(function () {
        root.className = "hidden";
        root.textContent = "";
      }, 2600);
    }

    function formatDate(value) {
      return typeof ctx.formatDate === "function" ? ctx.formatDate(value) : "—";
    }

    function statusChip(state) {
      return typeof ctx.statusChip === "function" ? ctx.statusChip(state) : String(state || "");
    }

    function actorContext() {
      var runtimeGlobal = typeof ctx.getRuntimeGlobal === "function" ? ctx.getRuntimeGlobal() : (typeof globalThis !== "undefined" ? globalThis : {});
      if (runtimeGlobal.reviewConsoleStore && runtimeGlobal.reviewConsoleStore.getActor) {
        return runtimeGlobal.reviewConsoleStore.getActor();
      }
      return { actorId: "desktop-local-reviewer", actorRole: "reviewer" };
    }

    function toggleReopenButton(state) {
      var doc = getDocument();
      var reopenBtn = doc && doc.getElementById ? doc.getElementById("review-action-reopen") : null;
      var approveBtn = doc && doc.getElementById ? doc.getElementById("review-action-approve") : null;
      var rejectBtn = doc && doc.getElementById ? doc.getElementById("review-action-reject") : null;
      var normalizedState = String(state || "").trim().toLowerCase();
      var allowApproveReject = normalizedState === "under_review";
      if (!reopenBtn) {
        if (approveBtn) {
          approveBtn.disabled = !allowApproveReject;
        }
        if (rejectBtn) {
          rejectBtn.disabled = !allowApproveReject;
        }
        return;
      }
      var allow = normalizedState === "rejected";
      reopenBtn.classList.toggle("hidden", !allow);
      reopenBtn.disabled = !allow;
      if (approveBtn) {
        approveBtn.disabled = !allowApproveReject;
      }
      if (rejectBtn) {
        rejectBtn.disabled = !allowApproveReject;
      }
    }

    function renderQcFindings(findings) {
      var doc = getDocument();
      var el = doc && doc.getElementById ? doc.getElementById("review-detail-qc") : null;
      if (!el) {
        return;
      }
      if (!Array.isArray(findings) || findings.length === 0) {
        el.innerHTML = '<p class="auth-subtle">No QC findings available for this submission.</p>';
        return;
      }
      el.innerHTML = findings
        .map(function (finding) {
          var ruleId = finding.rule_id || finding.ruleId || finding.event_name || "QC Finding";
          var message = finding.message || finding.status || JSON.stringify(finding);
          var severity = String(finding.severity || (finding.blocking ? "blocking" : "warning")).toLowerCase();
          var severityClass = severity === "blocking" ? "blocking" : "";
          return '<div class="fe-finding ' + severityClass + '"><strong>' + ctx.escapeHtml(ruleId) + '</strong>: ' + ctx.escapeHtml(message) + "</div>";
        })
        .join("");
    }

    function renderTags(tags) {
      var doc = getDocument();
      var list = doc && doc.getElementById ? doc.getElementById("review-detail-tags-list") : null;
      if (!list) {
        return;
      }
      if (!Array.isArray(tags) || tags.length === 0) {
        list.innerHTML = '<p class="auth-subtle">No tags added.</p>';
        return;
      }
      list.innerHTML = tags
        .map(function (tag) {
          return '<span class="fe-tag active">' + ctx.escapeHtml(tag.tag || "") + "</span>";
        })
        .join(" ");
    }

    function renderFlags(flags) {
      var doc = getDocument();
      var list = doc && doc.getElementById ? doc.getElementById("review-detail-flags-list") : null;
      if (!list) {
        return;
      }
      if (!Array.isArray(flags) || flags.length === 0) {
        list.innerHTML = '<p class="auth-subtle">No flags added.</p>';
        return;
      }
      list.innerHTML = flags
        .map(function (flag) {
          return '<div class="text-sm mb-1"><strong>' + ctx.escapeHtml(flag.flag_type || flag.flagType || "") +
            "</strong> · " + ctx.escapeHtml(flag.severity || "") + "</div>";
        })
        .join("");
    }

    function renderMetadata(detail) {
      var submission = detail.submission || {};
      var metadata = detail.metadata || {};

      setText("review-detail-pack-name", submission.packName || submission.submissionId || "—");
      setText("review-detail-sub-id", submission.submissionId || "—");
      setText("review-detail-creator", submission.creatorId || "—");
      setText("review-detail-submitted", formatDate(submission.submittedAt));
      setText("review-detail-version", metadata.version == null ? "—" : metadata.version);
      setText("review-detail-updated", formatDate(metadata.updated_at || metadata.updatedAt));

      var doc = getDocument();
      var stateEl = doc && doc.getElementById ? doc.getElementById("review-detail-state") : null;
      if (stateEl) {
        stateEl.innerHTML = statusChip(submission.state || "under_review");
      }
      toggleReopenButton(submission.state);
    }

    function getTemplate() {
      var reloadBtn = ctx.wrapControl("button", {
        control: "review-detail-reload",
        type: "button",
        tone: "secondary",
      }, "auth-button-secondary");
      var approveBtn = ctx.wrapControl("button", {
        control: "review-action-approve",
        type: "button",
        tone: "primary",
      }, "auth-button");
      var rejectBtn = ctx.wrapControl("button", {
        control: "review-action-reject",
        type: "button",
        tone: "danger",
        className: "fe-danger-btn",
      }, "fe-danger-btn");
      var reopenBtn = ctx.wrapControl("button", {
        control: "review-action-reopen",
        type: "button",
        tone: "secondary",
      }, "auth-button-secondary");
      var addTagInput = ctx.wrapControl("input", {
        control: "review-add-tag-input",
        type: "text",
      }, "auth-input");
      var addTagBtn = ctx.wrapControl("button", {
        control: "review-add-tag-btn",
        type: "button",
        tone: "secondary",
      }, "auth-button-secondary");
      var addFlagType = ctx.wrapControl("input", {
        control: "review-add-flag-type",
        type: "text",
      }, "auth-input");
      var addFlagSeverity = ctx.wrapControl("input", {
        control: "review-add-flag-severity",
        type: "text",
      }, "auth-input");
      var addFlagBtn = ctx.wrapControl("button", {
        control: "review-add-flag-btn",
        type: "button",
        tone: "secondary",
      }, "auth-button-secondary");
      var rejectReason = ctx.wrapControl("select", {
        control: "review-reject-reason",
      }, "auth-input");
      var rejectNotes = ctx.wrapControl("textarea", {
        control: "review-reject-notes",
        className: "min-h-24",
      }, "auth-input min-h-24");
      var rejectCancel = ctx.wrapControl("button", {
        control: "review-reject-cancel",
        type: "button",
        tone: "secondary",
      }, "auth-button-secondary");
      var rejectSubmit = ctx.wrapControl("button", {
        control: "review-reject-submit",
        type: "button",
        tone: "danger",
        className: "fe-danger-btn",
      }, "fe-danger-btn");
      var confirmCancel = ctx.wrapControl("button", {
        control: "review-confirm-cancel",
        type: "button",
        tone: "secondary",
      }, "auth-button-secondary");
      var confirmSubmit = ctx.wrapControl("button", {
        control: "review-confirm-submit",
        type: "button",
        tone: "primary",
      }, "auth-button");
      return [
        '<section class="fe-view hidden" data-view="reviewer-decision" id="view-reviewer-decision">',
        '  <div id="review-toast" class="hidden"></div>',
        '  <div class="fe-view-inner fe-page-shell">',
        '    <header class="fe-view-header items-end gap-4">',
        '      <div>',
        '        <p class="fe-view-eyebrow">Review</p>',
        '        <h2 class="fe-view-title">Review Detail</h2>',
        "      </div>",
        '      <button id="review-detail-reload" class="' + reloadBtn.className + '" ' + reloadBtn.attrString + ' aria-label="Reload review detail">Reload</button>',
        "    </header>",
        '    <p id="review-detail-feedback" class="auth-feedback hidden mb-3" aria-live="polite"></p>',
        '    <div class="grid gap-6 lg:grid-cols-3">',
        '      <div class="fe-surface lg:col-span-2">',
        '        <h3 class="fe-card-title mb-3">Metadata</h3>',
        '        <dl class="fe-dl grid gap-3 md:grid-cols-2">',
        '          <div class="rounded-brand-sm bg-brand-surface px-3 py-2">',
        '            <dt class="fe-dt text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Pack Name</dt><dd class="fe-dd font-medium" id="review-detail-pack-name">—</dd>',
        '          </div>',
        '          <div class="rounded-brand-sm bg-brand-surface px-3 py-2">',
        '            <dt class="fe-dt text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Submission ID</dt><dd class="fe-dd font-medium" id="review-detail-sub-id">—</dd>',
        '          </div>',
        '          <div class="rounded-brand-sm bg-brand-surface px-3 py-2">',
        '            <dt class="fe-dt text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Creator</dt><dd class="fe-dd" id="review-detail-creator">—</dd>',
        '          </div>',
        '          <div class="rounded-brand-sm bg-brand-surface px-3 py-2">',
        '            <dt class="fe-dt text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Submitted</dt><dd class="fe-dd" id="review-detail-submitted">—</dd>',
        '          </div>',
        '          <div class="rounded-brand-sm bg-brand-surface px-3 py-2">',
        '            <dt class="fe-dt text-[11px] uppercase tracking-[0.2em] text-brand-text/60">State</dt><dd class="fe-dd" id="review-detail-state">—</dd>',
        '          </div>',
        '          <div class="rounded-brand-sm bg-brand-surface px-3 py-2">',
        '            <dt class="fe-dt text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Version</dt><dd class="fe-dd" id="review-detail-version">—</dd>',
        '          </div>',
        '          <div class="rounded-brand-sm bg-brand-surface px-3 py-2">',
        '            <dt class="fe-dt text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Updated</dt><dd class="fe-dd" id="review-detail-updated">—</dd>',
        '          </div>',
        "        </dl>",
        "      </div>",
        '      <div class="fe-surface">',
        '        <h3 class="fe-card-title mb-3">Action Bar</h3>',
        '        <p id="review-action-guidance" class="auth-subtle mb-4">Use approve, reject, or re-open intentionally. Reject requires a reason code and reviewer notes.</p>',
        '        <div class="flex flex-col gap-2">',
        '          <button id="review-action-approve" class="' + approveBtn.className + '" ' + approveBtn.attrString + ' aria-label="Approve submission">Approve</button>',
        '          <button id="review-action-reject" class="' + rejectBtn.className + '" ' + rejectBtn.attrString + ' aria-label="Reject submission">Reject</button>',
        '          <button id="review-action-reopen" class="' + reopenBtn.className + ' hidden" ' + reopenBtn.attrString + ' aria-label="Re-open submission for amendment">Re-open</button>',
        "        </div>",
        "      </div>",
        "    </div>",
        '    <div class="grid gap-6 lg:grid-cols-2">',
        '      <div class="fe-surface">',
        '        <h3 class="fe-card-title mb-3">QC Findings</h3>',
        '        <div id="review-detail-qc" class="space-y-2 text-sm"></div>',
        "      </div>",
        '      <div class="fe-surface">',
        '        <h3 class="fe-card-title mb-3">Tags + Flags</h3>',
        '        <div class="mb-4">',
        '          <label class="fe-label" for="review-add-tag-input">Add Tag</label>',
        '          <div class="flex gap-2">',
        '            <input id="review-add-tag-input" class="' + addTagInput.className + '" ' + addTagInput.attrString + ' placeholder="metadata" />',
        '            <button id="review-add-tag-btn" class="' + addTagBtn.className + '" ' + addTagBtn.attrString + '>Add</button>',
        "          </div>",
        '          <div id="review-detail-tags-list" class="mt-2 flex flex-wrap gap-2"></div>',
        "        </div>",
        '        <div>',
        '          <label class="fe-label" for="review-add-flag-type">Add Flag</label>',
        '          <div class="grid grid-cols-3 gap-2">',
        '            <input id="review-add-flag-type" class="' + addFlagType.className + ' col-span-2" ' + addFlagType.attrString + ' placeholder="policy" aria-label="Flag type" />',
        '            <input id="review-add-flag-severity" class="' + addFlagSeverity.className + '" ' + addFlagSeverity.attrString + ' placeholder="high" aria-label="Flag severity" />',
        "          </div>",
        '          <button id="review-add-flag-btn" class="' + addFlagBtn.className + ' mt-2" ' + addFlagBtn.attrString + '>Add Flag</button>',
        '          <div id="review-detail-flags-list" class="mt-2"></div>',
        "        </div>",
        "      </div>",
        "    </div>",
        "  </div>",
        '  <div id="review-reject-modal" class="hidden fixed inset-0 z-40 bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="review-reject-title" aria-describedby="review-reject-help review-reject-validation">',
        '    <div class="max-w-lg mx-auto mt-20 fe-surface">',
        '      <h3 id="review-reject-title" class="fe-card-title mb-3">Reject Submission</h3>',
        '      <p id="review-reject-help" class="auth-subtle mb-2">Reason code and reviewer notes are both required. Include clear amendment guidance for the creator.</p>',
        '      <p id="review-reject-validation" class="auth-feedback error hidden mb-2" role="alert" aria-live="assertive"></p>',
        '      <label class="fe-label" for="review-reject-reason">Rejection reason code</label>',
        '      <select id="review-reject-reason" class="' + rejectReason.className + '" ' + rejectReason.attrString + ' required aria-describedby="review-reject-help review-reject-validation" data-modal-autofocus>',
        '        <option value="">Select reason code</option>',
        '        <option value="QUALITY_ISSUES">QUALITY_ISSUES</option>',
        '        <option value="METADATA_MISSING">METADATA_MISSING</option>',
        '        <option value="POLICY_VIOLATION">POLICY_VIOLATION</option>',
        '        <option value="OTHER">OTHER</option>',
        "      </select>",
        '      <label class="fe-label mt-3" for="review-reject-notes">Reviewer notes</label>',
        '      <textarea id="review-reject-notes" class="' + rejectNotes.className + '" ' + rejectNotes.attrString + ' placeholder="Provide reviewer notes." required aria-describedby="review-reject-help review-reject-validation"></textarea>',
        '      <div class="flex justify-end gap-2 mt-4">',
        '        <button id="review-reject-cancel" class="' + rejectCancel.className + '" ' + rejectCancel.attrString + ' aria-label="Cancel rejection">Cancel</button>',
        '        <button id="review-reject-submit" class="' + rejectSubmit.className + '" ' + rejectSubmit.attrString + ' aria-label="Continue with rejection">Continue</button>',
        "      </div>",
        "    </div>",
        "  </div>",
        '  <div id="review-confirm-modal" class="hidden fixed inset-0 z-40 bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="review-confirm-title" aria-describedby="review-confirm-message">',
        '    <div class="max-w-md mx-auto mt-24 fe-surface">',
        '      <h3 id="review-confirm-title" class="fe-card-title mb-3">Confirm Decision</h3>',
        '      <p id="review-confirm-message" class="auth-subtle">Confirm action?</p>',
        '      <p id="review-confirm-guidance" class="auth-subtle mt-2">Confirm this reviewer action.</p>',
        '      <div class="flex justify-end gap-2 mt-4">',
        '        <button id="review-confirm-cancel" class="' + confirmCancel.className + '" ' + confirmCancel.attrString + ' aria-label="Cancel review decision">Cancel</button>',
        '        <button id="review-confirm-submit" class="' + confirmSubmit.className + '" ' + confirmSubmit.attrString + ' aria-label="Confirm review decision" data-modal-autofocus>Confirm</button>',
        "      </div>",
        "    </div>",
        "  </div>",
        "</section>",
      ].join("\n");
    }

    return {
      setText: setText,
      showFeedback: showFeedback,
      showToast: showToast,
      renderMetadata: renderMetadata,
      renderQcFindings: renderQcFindings,
      renderTags: renderTags,
      renderFlags: renderFlags,
      toggleReopenButton: toggleReopenButton,
      actorContext: actorContext,
      getTemplate: getTemplate,
    };
  }

  return {
    createReviewDetailRender: createReviewDetailRender,
  };
});
