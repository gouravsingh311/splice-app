/* Review Queue render helpers for PRD-08 queue triage. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewQueueRender = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createReviewQueueRender(ctx) {
    function getDocument() {
      return typeof ctx.getDocument === "function" ? ctx.getDocument() : null;
    }

    function renderRows(items, emptyMessage) {
      var doc = getDocument();
      var tbody = doc && doc.getElementById ? doc.getElementById("review-queue-tbody") : null;
      if (!tbody) {
        return;
      }
      if (!Array.isArray(items) || items.length === 0) {
        tbody.innerHTML = '<tr><td class="fe-td-empty" colspan="7">' +
          ctx.escapeHtml(emptyMessage || "No submissions in review queue. Under-review packs will appear here.") +
          "</td></tr>";
        return;
      }

      tbody.innerHTML = items
        .map(function (item) {
          var state = String(item && item.state || "").toLowerCase();
          var triageDisabled = state !== "under_review";
          var approveBtn = ctx.wrapControl("button", {
            control: "review-queue-quick-approve",
            tone: "primary",
            size: "sm",
            className: "min-h-8 px-3 py-1.5 text-xs shadow-brand-sm",
            uiId: item.submissionId || "",
          }, "auth-button-secondary py-1 px-2 text-xs");
          var rejectBtn = ctx.wrapControl("button", {
            control: "review-queue-quick-reject",
            tone: "danger",
            size: "sm",
            className: "fe-danger-btn min-h-8 px-3 py-1.5 text-xs",
            uiId: item.submissionId || "",
          }, "fe-danger-btn py-1 px-2 text-xs");
          var openBtn = ctx.wrapControl("button", {
            control: "review-queue-open",
            tone: "ghost",
            size: "sm",
            className: "text-xs font-semibold text-brand-text underline underline-offset-4",
            uiId: item.submissionId || "",
          }, "fe-link-btn");
          var disabledAttrs = triageDisabled ? ' disabled aria-disabled="true"' : "";
          return (
            '<tr class="cursor-pointer border-b border-brand-border/50 odd:bg-brand-surface-alt/60 hover:bg-brand-surface-alt/80 transition" data-review-sub-id="' +
            ctx.escapeHtml(item.submissionId) +
            '">' +
            '<td class="fe-td font-semibold">' +
            ctx.escapeHtml(item.packName || item.submissionId) +
            "</td>" +
            '<td class="fe-td">' +
            ctx.escapeHtml(item.creatorId || "-") +
            "</td>" +
            '<td class="fe-td">' +
            ctx.escapeHtml(ctx.formatDate(item.submittedAt)) +
            "</td>" +
            '<td class="fe-td">' +
            ctx.statusChip(item.state) +
            "</td>" +
            '<td class="fe-td">' +
            ctx.escapeHtml(String(item.ageDays || 0)) +
            "</td>" +
            '<td class="fe-td">' +
            ctx.escapeHtml(typeof ctx.getRiskLabel === "function" ? ctx.getRiskLabel(item) : "None") +
            "</td>" +
            '<td class="fe-td">' +
            '<div class="flex flex-wrap items-center gap-2 justify-end">' +
            '<button class="' + approveBtn.className + '" ' + approveBtn.attrString + disabledAttrs + ' data-quick-approve="' +
            ctx.escapeHtml(item.submissionId) +
            '">Approve</button>' +
            '<button class="' + rejectBtn.className + '" ' + rejectBtn.attrString + disabledAttrs + ' data-quick-reject="' +
            ctx.escapeHtml(item.submissionId) +
            '">Reject</button>' +
            '<button class="' + openBtn.className + '" ' + openBtn.attrString + ' data-open-review-detail="' +
            ctx.escapeHtml(item.submissionId) +
            '">Open</button>' +
            "</div>" +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    }

    function renderFromCache() {
      var filters = typeof ctx.readFilters === "function" ? ctx.readFilters() : {};
      var queueItems = ctx.state && Array.isArray(ctx.state.queueItems) ? ctx.state.queueItems : [];
      var visibleItems = typeof ctx.applyClientFilters === "function"
        ? ctx.applyClientFilters(queueItems, filters)
        : queueItems;
      renderRows(visibleItems, "No submissions in review queue. Under-review packs will appear here.");
      if (typeof ctx.setFeedback === "function") {
        ctx.setFeedback("Loaded " + visibleItems.length + " queue item(s) using deterministic triage order.", "");
      }
    }

    function getTemplate() {
      var refreshBtn = ctx.wrapControl("button", {
        control: "review-queue-refresh",
        type: "button",
        tone: "secondary",
        className: "min-h-9",
      }, "auth-button-secondary");
      var stateFilter = ctx.wrapControl("select", { control: "review-queue-state-filter" }, "auth-input");
      var ageFilter = ctx.wrapControl("select", { control: "review-queue-age-filter" }, "auth-input");
      var riskFilter = ctx.wrapControl("select", { control: "review-queue-risk-filter" }, "auth-input");
      var tagFilter = ctx.wrapControl("input", { control: "review-queue-tag-filter", type: "text" }, "auth-input");
      var flagFilter = ctx.wrapControl("input", { control: "review-queue-flag-filter", type: "text" }, "auth-input");
      var rejectReason = ctx.wrapControl("select", { control: "review-queue-reject-reason" }, "auth-input");
      var rejectNotes = ctx.wrapControl("textarea", {
        control: "review-queue-reject-notes",
        className: "min-h-24",
      }, "auth-input min-h-24");
      var rejectCancel = ctx.wrapControl("button", {
        control: "review-queue-reject-cancel",
        type: "button",
        tone: "secondary",
      }, "auth-button-secondary");
      var rejectSubmit = ctx.wrapControl("button", {
        control: "review-queue-reject-submit",
        type: "button",
        tone: "danger",
        className: "fe-danger-btn",
      }, "fe-danger-btn");
      return [
        '<section class="fe-view hidden" data-view="reviewer-queue" id="view-reviewer-queue">',
        '  <div class="fe-view-inner fe-page-shell">',
        '    <header class="fe-view-header items-end gap-4">',
        '      <div>',
        '        <p class="fe-view-eyebrow">Reviewer</p>',
        '        <h2 class="fe-view-title">Review Queue</h2>',
        "      </div>",
        '      <button id="review-queue-refresh" class="' + refreshBtn.className + '" ' + refreshBtn.attrString + '>Refresh</button>',
        "    </header>",
        '    <div class="fe-surface space-y-4">',
        '      <div class="rounded-[16px] border border-brand-border/40 bg-brand-surface/70 px-4 py-4">',
        '        <div class="grid gap-3 md:grid-cols-5">',
        '        <div>',
        '          <label class="fe-label" for="review-queue-state-filter">State</label>',
        '          <select id="review-queue-state-filter" class="' + stateFilter.className + '" ' + stateFilter.attrString + '>',
        '            <option value="under_review">Under Review</option>',
        '            <option value="">All</option>',
        '            <option value="rejected">Rejected</option>',
        '            <option value="approved">Approved</option>',
        "          </select>",
        "        </div>",
        '        <div>',
        '          <label class="fe-label" for="review-queue-age-filter">Age</label>',
        '          <select id="review-queue-age-filter" class="' + ageFilter.className + '" ' + ageFilter.attrString + '>',
        '            <option value="">All</option>',
        '            <option value="0-2">0-2 days</option>',
        '            <option value="3-7">3-7 days</option>',
        '            <option value="8+">8+ days</option>',
        "          </select>",
        "        </div>",
        '        <div>',
        '          <label class="fe-label" for="review-queue-risk-filter">Risk</label>',
        '          <select id="review-queue-risk-filter" class="' + riskFilter.className + '" ' + riskFilter.attrString + '>',
        '            <option value="">All</option>',
        '            <option value="high">High</option>',
        '            <option value="medium">Medium</option>',
        '            <option value="low">Low</option>',
        '            <option value="none">None</option>',
        "          </select>",
        "        </div>",
        '        <div>',
        '          <label class="fe-label" for="review-queue-tag-filter">Tag</label>',
        '          <input id="review-queue-tag-filter" class="' + tagFilter.className + '" ' + tagFilter.attrString + ' placeholder="metadata" />',
        "        </div>",
        '        <div>',
        '          <label class="fe-label" for="review-queue-flag-filter">Flag</label>',
        '          <input id="review-queue-flag-filter" class="' + flagFilter.className + '" ' + flagFilter.attrString + ' placeholder="policy" />',
        "        </div>",
        "        </div>",
        "      </div>",
        '      <p id="review-queue-feedback" class="auth-feedback hidden mb-3 mt-3" aria-live="polite"></p>',
        '      <div class="fe-table-shell">',
        '        <table class="fe-table">',
        '          <thead class="text-[11px] uppercase tracking-[0.2em] text-brand-text/60 bg-brand-surface-alt/70">',
        '            <tr>',
        '              <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Pack Name</th>',
        '              <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Creator</th>',
        '              <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Submitted At</th>',
        '              <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">State</th>',
        '              <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Age (days)</th>',
        '              <th class="fe-th text-[11px] uppercase tracking-[0.2em] text-brand-text/60">Risk</th>',
        '              <th class="fe-th text-right">Triage</th>',
        "            </tr>",
        "          </thead>",
        '          <tbody id="review-queue-tbody">',
        '            <tr><td class="fe-td-empty bg-brand-surface-alt/30" colspan="7">Loading queue...</td></tr>',
        "          </tbody>",
        "        </table>",
        "      </div>",
        '      <div id="review-queue-reject-modal" class="hidden fixed inset-0 z-40 bg-black/40 p-4">',
        '        <div class="mx-auto mt-24 max-w-md fe-surface">',
        '          <h3 class="text-base font-semibold text-brand-text-strong">Reject Submission</h3>',
        '          <input id="review-queue-reject-submission" type="hidden" />',
        '          <label class="fe-label mt-3" for="review-queue-reject-reason">Reason Code</label>',
        '          <select id="review-queue-reject-reason" class="' + rejectReason.className + '" ' + rejectReason.attrString + '>',
        '            <option value="">Select reason</option>',
        '            <option value="QUALITY_ISSUES">QUALITY_ISSUES</option>',
        '            <option value="METADATA_MISSING">METADATA_MISSING</option>',
        '            <option value="POLICY_VIOLATION">POLICY_VIOLATION</option>',
        '            <option value="OTHER">OTHER</option>',
        "          </select>",
        '          <label class="fe-label mt-3" for="review-queue-reject-notes">Notes</label>',
        '          <textarea id="review-queue-reject-notes" class="' + rejectNotes.className + '" ' + rejectNotes.attrString + ' placeholder="Provide reviewer notes."></textarea>',
        '          <div class="mt-4 flex justify-end gap-2">',
        '            <button id="review-queue-reject-cancel" class="' + rejectCancel.className + '" ' + rejectCancel.attrString + '>Cancel</button>',
        '            <button id="review-queue-reject-submit" class="' + rejectSubmit.className + '" ' + rejectSubmit.attrString + '>Reject</button>',
        "          </div>",
        "        </div>",
        "      </div>",
        "    </div>",
        "  </div>",
        "</section>",
      ].join("\n");
    }

    return {
      renderRows: renderRows,
      renderFromCache: renderFromCache,
      getTemplate: getTemplate,
    };
  }

  return {
    createReviewQueueRender: createReviewQueueRender,
  };
});
