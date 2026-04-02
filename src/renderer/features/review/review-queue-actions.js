/* Review Queue actions/wiring for PRD-08 queue triage. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewQueueActions = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createReviewQueueActions(ctx) {
    function getDocument() {
      return typeof ctx.getDocument === "function" ? ctx.getDocument() : null;
    }

    function getRuntimeGlobal() {
      return typeof ctx.getRuntimeGlobal === "function" ? ctx.getRuntimeGlobal() : (typeof globalThis !== "undefined" ? globalThis : {});
    }

    function setFeedback(message, tone) {
      var doc = getDocument();
      var el = doc && doc.getElementById ? doc.getElementById("review-queue-feedback") : null;
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

    function readFilters() {
      var doc = getDocument();
      var stateEl = doc && doc.getElementById ? doc.getElementById("review-queue-state-filter") : null;
      var tagEl = doc && doc.getElementById ? doc.getElementById("review-queue-tag-filter") : null;
      var flagEl = doc && doc.getElementById ? doc.getElementById("review-queue-flag-filter") : null;
      var ageEl = doc && doc.getElementById ? doc.getElementById("review-queue-age-filter") : null;
      var riskEl = doc && doc.getElementById ? doc.getElementById("review-queue-risk-filter") : null;
      return {
        state: stateEl ? stateEl.value.trim() : "",
        tag: tagEl ? tagEl.value.trim() : "",
        flag: flagEl ? flagEl.value.trim() : "",
        ageBucket: ageEl ? ageEl.value.trim() : "",
        riskLevel: riskEl ? riskEl.value.trim() : "",
      };
    }

    function getCurrentActor() {
      return getRuntimeGlobal().reviewConsoleStore
        ? getRuntimeGlobal().reviewConsoleStore.getActor()
        : { actorId: "desktop-local-reviewer", actorRole: "reviewer" };
    }

    async function loadQueue() {
      var state = ctx.state || {};
      if (!state.bridgeApi || !state.bridgeApi.review || !state.bridgeApi.review.listQueue) {
        setFeedback("Review API bridge unavailable.", "warning");
        return;
      }

      var actor = getRuntimeGlobal().reviewConsoleStore
        ? getRuntimeGlobal().reviewConsoleStore.getActor()
        : { actorId: "desktop-local-reviewer", actorRole: "reviewer" };
      if (actor.actorRole !== "reviewer" && actor.actorRole !== "admin") {
        setFeedback("Review queue requires reviewer or admin role.", "warning");
        if (typeof ctx.renderRows === "function") {
          ctx.renderRows([], "Review queue requires reviewer/admin access.");
        }
        return;
      }

      var filters = readFilters();

      try {
        var response = await state.bridgeApi.review.listQueue({
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          state: filters.state || null,
          tag: filters.tag || null,
          flag: filters.flag || null,
        });

        if (!response.ok) {
          var fallbackItems = getRuntimeGlobal().reviewConsoleStore && getRuntimeGlobal().reviewConsoleStore.getQueueItems
            ? getRuntimeGlobal().reviewConsoleStore.getQueueItems()
            : [];
          var resolvedState = typeof ctx.resolveQueueState === "function"
            ? ctx.resolveQueueState({
                hasItems: Array.isArray(fallbackItems) && fallbackItems.length > 0,
                backendUnreachable: typeof ctx.isBackendUnreachable === "function" ? ctx.isBackendUnreachable(response.error) : false,
              })
            : { tone: "error", feedback: "Failed to load review queue.", emptyMessage: "Unable to load review queue." };
          setFeedback(resolvedState.feedback, resolvedState.tone);
          if (typeof ctx.renderRows === "function") {
            ctx.renderRows(fallbackItems, resolvedState.emptyMessage);
          }
          return;
        }

        state.queueItems = Array.isArray(response.data.items) ? response.data.items : [];
        if (getRuntimeGlobal().reviewConsoleStore && getRuntimeGlobal().reviewConsoleStore.setQueueItems) {
          getRuntimeGlobal().reviewConsoleStore.setQueueItems(state.queueItems);
        }
        if (typeof ctx.renderFromCache === "function") {
          ctx.renderFromCache();
        }
      } catch (error) {
        var fallbackItems = getRuntimeGlobal().reviewConsoleStore && getRuntimeGlobal().reviewConsoleStore.getQueueItems
          ? getRuntimeGlobal().reviewConsoleStore.getQueueItems()
          : [];
        var resolvedState = typeof ctx.resolveQueueState === "function"
          ? ctx.resolveQueueState({
              hasItems: Array.isArray(fallbackItems) && fallbackItems.length > 0,
              backendUnreachable: typeof ctx.isBackendUnreachable === "function" ? ctx.isBackendUnreachable(error) : false,
            })
          : { tone: "error", feedback: "Failed to load review queue.", emptyMessage: "Unable to load review queue." };
        setFeedback(resolvedState.feedback, resolvedState.tone);
        if (typeof ctx.renderRows === "function") {
          ctx.renderRows(fallbackItems, resolvedState.emptyMessage);
        }
      }
    }

    async function quickApprove(submissionId) {
      var state = ctx.state || {};
      if (!state.bridgeApi || !state.bridgeApi.review || !state.bridgeApi.review.approve) {
        setFeedback("Approve action unavailable in current desktop bridge.", "warning");
        return;
      }

      var actor = getCurrentActor();
      try {
        var response = await state.bridgeApi.review.approve({
          submissionId: submissionId,
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          requestId: "queue-approve-" + submissionId + "-" + String(Date.now()),
        });

        if (!response.ok) {
          setFeedback(response.error && response.error.message ? response.error.message : "Approve action failed.", "error");
          return;
        }

        setFeedback("Approved " + submissionId + " from queue triage.", "");
        await loadQueue();
      } catch (error) {
        setFeedback("Approve action failed: " + error.message, "error");
      }
    }

    function openRejectModal(submissionId) {
      var doc = getDocument();
      var modal = doc && doc.getElementById ? doc.getElementById("review-queue-reject-modal") : null;
      if (!modal) {
        return;
      }

      var submissionEl = doc.getElementById("review-queue-reject-submission");
      var reasonEl = doc.getElementById("review-queue-reject-reason");
      var notesEl = doc.getElementById("review-queue-reject-notes");

      if (submissionEl) {
        submissionEl.value = submissionId || "";
      }
      if (reasonEl) {
        reasonEl.value = "";
      }
      if (notesEl) {
        notesEl.value = "";
      }

      modal.classList.remove("hidden");
    }

    function closeRejectModal() {
      var doc = getDocument();
      var modal = doc && doc.getElementById ? doc.getElementById("review-queue-reject-modal") : null;
      if (modal) {
        modal.classList.add("hidden");
      }
    }

    async function submitQuickReject() {
      var state = ctx.state || {};
      if (!state.bridgeApi || !state.bridgeApi.review || !state.bridgeApi.review.reject) {
        setFeedback("Reject action unavailable in current desktop bridge.", "warning");
        return;
      }

      var doc = getDocument();
      var submissionEl = doc.getElementById("review-queue-reject-submission");
      var reasonEl = doc.getElementById("review-queue-reject-reason");
      var notesEl = doc.getElementById("review-queue-reject-notes");

      var submissionId = submissionEl ? submissionEl.value : "";
      var reasonCode = reasonEl ? reasonEl.value : "";
      var notes = notesEl ? notesEl.value.trim() : "";

      if (!submissionId || !reasonCode || !notes) {
        setFeedback("Reject requires reason code and notes.", "warning");
        return;
      }

      var actor = getCurrentActor();
      try {
        var response = await state.bridgeApi.review.reject({
          submissionId: submissionId,
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          requestId: "queue-reject-" + submissionId + "-" + String(Date.now()),
          reasonCode: reasonCode,
          notes: notes,
        });

        if (!response.ok) {
          setFeedback(response.error && response.error.message ? response.error.message : "Reject action failed.", "error");
          return;
        }

        closeRejectModal();
        setFeedback("Rejected " + submissionId + " from queue triage.", "");
        await loadQueue();
      } catch (error) {
        setFeedback("Reject action failed: " + error.message, "error");
      }
    }

    function openDetail(submissionId) {
      if (getRuntimeGlobal().reviewConsoleStore && getRuntimeGlobal().reviewConsoleStore.setSelectedSubmissionId) {
        getRuntimeGlobal().reviewConsoleStore.setSelectedSubmissionId(submissionId);
      }

      var targetButton = getDocument().querySelector('[data-nav=\"reviewer-decision\"]');
      if (targetButton && typeof targetButton.click === "function") {
        targetButton.click();
      }
    }

    function scheduleFilterRefresh() {
      if (ctx.state && ctx.state.filterDebounceId) {
        getRuntimeGlobal().clearTimeout(ctx.state.filterDebounceId);
      }
      ctx.state.filterDebounceId = getRuntimeGlobal().setTimeout(function () {
        if (typeof ctx.renderFromCache === "function") {
          ctx.renderFromCache();
        }
      }, 120);
    }

    function wireEvents() {
      var doc = getDocument();
      var refreshBtn = doc.getElementById("review-queue-refresh");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", function () {
          void loadQueue();
        });
      }

      ["review-queue-state-filter", "review-queue-age-filter", "review-queue-risk-filter"].forEach(function (id) {
        var el = doc.getElementById(id);
        if (el) {
          el.addEventListener("change", function () {
            scheduleFilterRefresh();
          });
        }
      });

      ["review-queue-tag-filter", "review-queue-flag-filter"].forEach(function (id) {
        var el = doc.getElementById(id);
        if (el) {
          el.addEventListener("change", function () {
            void loadQueue();
          });
          el.addEventListener("input", function () {
            scheduleFilterRefresh();
          });
        }
      });

      var tbody = doc.getElementById("review-queue-tbody");
      if (tbody) {
        tbody.addEventListener("click", function (event) {
          var approveBtn = event.target && typeof event.target.closest === "function"
            ? event.target.closest("[data-quick-approve]")
            : null;
          if (approveBtn) {
            void quickApprove(approveBtn.getAttribute("data-quick-approve"));
            return;
          }

          var rejectBtn = event.target && typeof event.target.closest === "function"
            ? event.target.closest("[data-quick-reject]")
            : null;
          if (rejectBtn) {
            openRejectModal(rejectBtn.getAttribute("data-quick-reject"));
            return;
          }

          var openBtn = event.target && typeof event.target.closest === "function"
            ? event.target.closest("[data-open-review-detail]")
            : null;
          if (openBtn) {
            openDetail(openBtn.getAttribute("data-open-review-detail"));
            return;
          }

          var row = event.target && typeof event.target.closest === "function"
            ? event.target.closest("[data-review-sub-id]")
            : null;
          if (row) {
            openDetail(row.getAttribute("data-review-sub-id"));
          }
        });
      }

      var rejectCancel = doc.getElementById("review-queue-reject-cancel");
      if (rejectCancel) {
        rejectCancel.addEventListener("click", function () {
          closeRejectModal();
        });
      }

      var rejectSubmit = doc.getElementById("review-queue-reject-submit");
      if (rejectSubmit) {
        rejectSubmit.addEventListener("click", function () {
          void submitQuickReject();
        });
      }

      if (getRuntimeGlobal() && typeof getRuntimeGlobal().addEventListener === "function") {
        getRuntimeGlobal().addEventListener("review:queue-refresh", function () {
          void loadQueue();
        });
        getRuntimeGlobal().addEventListener("review:actor-updated", function () {
          void loadQueue();
        });
      }
    }

    function wire(options) {
      ctx.state = ctx.state || {};
      ctx.state.bridgeApi = options && options.api ? options.api : null;
      wireEvents();
      void loadQueue();
    }

    return {
      readFilters: readFilters,
      setFeedback: setFeedback,
      loadQueue: loadQueue,
      quickApprove: quickApprove,
      openRejectModal: openRejectModal,
      closeRejectModal: closeRejectModal,
      submitQuickReject: submitQuickReject,
      openDetail: openDetail,
      scheduleFilterRefresh: scheduleFilterRefresh,
      wireEvents: wireEvents,
      wire: wire,
    };
  }

  return {
    createReviewQueueActions: createReviewQueueActions,
  };
});
