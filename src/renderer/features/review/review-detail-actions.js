/* Review Detail actions/wiring for PRD-08 decision flow. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewDetailActions = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createReviewDetailActions(ctx) {
    ctx.state = ctx.state || {
      bridgeApi: null,
      currentSubmissionId: null,
      currentDetail: null,
      pendingAction: null,
      activeModalId: null,
      modalFocusRestoreEl: null,
    };

    function getDocument() {
      return typeof ctx.getDocument === "function" ? ctx.getDocument() : null;
    }

    function getRuntimeGlobal() {
      return typeof ctx.getRuntimeGlobal === "function" ? ctx.getRuntimeGlobal() : (typeof globalThis !== "undefined" ? globalThis : {});
    }

    function actorContext() {
      if (typeof ctx.actorContext === "function") {
        return ctx.actorContext();
      }
      var runtimeGlobal = getRuntimeGlobal();
      if (runtimeGlobal.reviewConsoleStore && runtimeGlobal.reviewConsoleStore.getActor) {
        return runtimeGlobal.reviewConsoleStore.getActor();
      }
      return { actorId: "desktop-local-reviewer", actorRole: "reviewer" };
    }

    function openModal(id) {
      var doc = getDocument();
      var el = doc && doc.getElementById ? doc.getElementById(id) : null;
      if (el) {
        ctx.state.modalFocusRestoreEl = doc.activeElement;
        el.classList.remove("hidden");
        ctx.state.activeModalId = id;
        var autoFocusTarget = el.querySelector("[data-modal-autofocus]") || el.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (autoFocusTarget && typeof autoFocusTarget.focus === "function") {
          autoFocusTarget.focus();
        }
      }
    }

    function closeModal(id) {
      var doc = getDocument();
      var el = doc && doc.getElementById ? doc.getElementById(id) : null;
      if (el) {
        el.classList.add("hidden");
      }
      if (ctx.state.activeModalId === id) {
        ctx.state.activeModalId = null;
        if (ctx.state.modalFocusRestoreEl && typeof ctx.state.modalFocusRestoreEl.focus === "function") {
          ctx.state.modalFocusRestoreEl.focus();
        }
        ctx.state.modalFocusRestoreEl = null;
      }
    }

    function getModalFocusableElements(modalEl) {
      if (!modalEl) {
        return [];
      }
      return Array.prototype.slice.call(
        modalEl.querySelectorAll(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )
      );
    }

    function resetRejectValidationState() {
      var doc = getDocument();
      var reasonCodeEl = doc.getElementById("review-reject-reason");
      var notesEl = doc.getElementById("review-reject-notes");
      var messageEl = doc.getElementById("review-reject-validation");

      if (reasonCodeEl) {
        reasonCodeEl.removeAttribute("aria-invalid");
      }
      if (notesEl) {
        notesEl.removeAttribute("aria-invalid");
      }
      if (messageEl) {
        messageEl.textContent = "";
        messageEl.classList.add("hidden");
      }
    }

    function resetRejectForm() {
      var doc = getDocument();
      var reasonCodeEl = doc.getElementById("review-reject-reason");
      var notesEl = doc.getElementById("review-reject-notes");
      if (reasonCodeEl) {
        reasonCodeEl.value = "";
      }
      if (notesEl) {
        notesEl.value = "";
      }
      resetRejectValidationState();
    }

    function showRejectValidation(message, reasonMissing, notesMissing) {
      var doc = getDocument();
      var reasonCodeEl = doc.getElementById("review-reject-reason");
      var notesEl = doc.getElementById("review-reject-notes");
      var messageEl = doc.getElementById("review-reject-validation");

      if (reasonCodeEl) {
        if (reasonMissing) {
          reasonCodeEl.setAttribute("aria-invalid", "true");
        } else {
          reasonCodeEl.removeAttribute("aria-invalid");
        }
      }
      if (notesEl) {
        if (notesMissing) {
          notesEl.setAttribute("aria-invalid", "true");
        } else {
          notesEl.removeAttribute("aria-invalid");
        }
      }
      if (messageEl) {
        messageEl.textContent = message;
        messageEl.classList.remove("hidden");
      }
    }

    function readRejectFormPayload() {
      var doc = getDocument();
      var reasonCodeEl = doc.getElementById("review-reject-reason");
      var notesEl = doc.getElementById("review-reject-notes");
      var reasonCode = reasonCodeEl ? reasonCodeEl.value.trim() : "";
      var notes = notesEl ? notesEl.value.trim() : "";
      return {
        reasonCode: reasonCode,
        notes: notes,
        reasonMissing: !reasonCode,
        notesMissing: !notes,
      };
    }

    function setConfirmCopy(actionLabel) {
      var submission = ctx.state.currentDetail ? ctx.state.currentDetail.submission || {} : {};
      if (typeof ctx.setText === "function") {
        ctx.setText("review-confirm-message", actionLabel + " “" + (submission.packName || submission.submissionId || "submission") + "” by " + (submission.creatorId || "unknown creator") + "?");
        var guidanceByAction = {
          approve: "Approval will trigger scheduling and delivery workflows.",
          reject: "Rejection notifies the creator with your reason code and notes.",
          reopen: "Re-open returns this submission to draft so the creator can amend and resubmit.",
        };
        ctx.setText("review-confirm-guidance", guidanceByAction[ctx.state.pendingAction && ctx.state.pendingAction.type ? ctx.state.pendingAction.type : ""] || "Confirm this reviewer action.");
      }
    }

    async function loadSubmission(submissionId) {
      if (!submissionId) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Select a submission from Review Queue.", "warning");
        }
        return;
      }
      if (!ctx.state.bridgeApi || !ctx.state.bridgeApi.review || !ctx.state.bridgeApi.review.getSubmission) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Review API bridge unavailable.", "warning");
        }
        return;
      }

      var actor = actorContext();
      if (actor.actorRole !== "reviewer" && actor.actorRole !== "admin") {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Review details require reviewer or admin role.", "warning");
        }
        return;
      }

      ctx.state.currentSubmissionId = submissionId;

      try {
        var response = await ctx.state.bridgeApi.review.getSubmission({
          submissionId: submissionId,
          actorId: actor.actorId,
          actorRole: actor.actorRole,
        });

        if (!response.ok) {
          if (typeof ctx.showFeedback === "function") {
            ctx.showFeedback(response.error && response.error.message ? response.error.message : "Failed to load submission.", "error");
          }
          return;
        }

        ctx.state.currentDetail = response.data;
        if (typeof ctx.renderMetadata === "function") {
          ctx.renderMetadata(ctx.state.currentDetail);
        }
        if (typeof ctx.renderQcFindings === "function") {
          ctx.renderQcFindings(ctx.state.currentDetail.qcFindings);
        }
        if (typeof ctx.renderTags === "function") {
          ctx.renderTags(ctx.state.currentDetail.tags);
        }
        if (typeof ctx.renderFlags === "function") {
          ctx.renderFlags(ctx.state.currentDetail.flags);
        }
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Loaded review detail.", "");
        }
      } catch (error) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Failed to load submission detail: " + error.message, "error");
        }
      }
    }

    async function addTag() {
      var doc = getDocument();
      var input = doc.getElementById("review-add-tag-input");
      var tag = input ? input.value.trim() : "";
      if (!tag) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Tag is required.", "warning");
        }
        return;
      }
      if (!ctx.state.currentSubmissionId) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Select a submission first.", "warning");
        }
        return;
      }

      var actor = actorContext();
      var response = await ctx.state.bridgeApi.review.addTag({
        submissionId: ctx.state.currentSubmissionId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tag: tag,
      });

      if (!response.ok) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback(response.error ? response.error.message : "Failed to add tag.", "error");
        }
        return;
      }

      if (input) {
        input.value = "";
      }
      if (typeof ctx.showToast === "function") {
        ctx.showToast("Tag added.", "success");
      }
      await loadSubmission(ctx.state.currentSubmissionId);
      if (getRuntimeGlobal().reviewConsoleStore) {
        getRuntimeGlobal().reviewConsoleStore.requestQueueRefresh();
      }
    }

    async function addFlag() {
      var doc = getDocument();
      var typeInput = doc.getElementById("review-add-flag-type");
      var severityInput = doc.getElementById("review-add-flag-severity");
      var flagType = typeInput ? typeInput.value.trim() : "";
      var severity = severityInput ? severityInput.value.trim() : "";
      if (!flagType || !severity) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Flag type and severity are required.", "warning");
        }
        return;
      }
      if (!ctx.state.currentSubmissionId) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Select a submission first.", "warning");
        }
        return;
      }

      var actor = actorContext();
      var response = await ctx.state.bridgeApi.review.addFlag({
        submissionId: ctx.state.currentSubmissionId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        flagType: flagType,
        severity: severity,
      });

      if (!response.ok) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback(response.error ? response.error.message : "Failed to add flag.", "error");
        }
        return;
      }

      if (typeInput) {
        typeInput.value = "";
      }
      if (severityInput) {
        severityInput.value = "";
      }
      if (typeof ctx.showToast === "function") {
        ctx.showToast("Flag added.", "success");
      }
      await loadSubmission(ctx.state.currentSubmissionId);
      if (getRuntimeGlobal().reviewConsoleStore) {
        getRuntimeGlobal().reviewConsoleStore.requestQueueRefresh();
      }
    }

    function queueAction(type, payload) {
      ctx.state.pendingAction = { type: type, payload: payload || {} };
      setConfirmCopy(type === "approve" ? "Approve" : type === "reject" ? "Reject" : "Re-open");
      openModal("review-confirm-modal");
    }

    async function executePendingAction() {
      if (!ctx.state.pendingAction || !ctx.state.currentSubmissionId) {
        closeModal("review-confirm-modal");
        return;
      }
      var currentState = String(
        ctx.state.currentDetail &&
        ctx.state.currentDetail.submission &&
        ctx.state.currentDetail.submission.state
          ? ctx.state.currentDetail.submission.state
          : ""
      )
        .trim()
        .toLowerCase();
      var actionType = ctx.state.pendingAction.type;
      if ((actionType === "approve" || actionType === "reject") && currentState !== "under_review") {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("This submission is no longer under review. Reload the page state.", "warning");
        }
        ctx.state.pendingAction = null;
        closeModal("review-confirm-modal");
        return;
      }
      if (actionType === "reopen" && currentState !== "rejected" && currentState !== "qc_failed") {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback("Re-open is allowed only for rejected or QC-failed submissions.", "warning");
        }
        ctx.state.pendingAction = null;
        closeModal("review-confirm-modal");
        return;
      }

      var actor = actorContext();
      var requestPayload = {
        submissionId: ctx.state.currentSubmissionId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        requestId: ctx.state.pendingAction.payload.requestId || (ctx.state.pendingAction.type + "-" + Date.now()),
        expectedVersion: ctx.state.currentDetail && ctx.state.currentDetail.metadata ? ctx.state.currentDetail.metadata.version : undefined,
        notes: ctx.state.pendingAction.payload.notes || null,
      };

      var response;
      try {
        if (ctx.state.pendingAction.type === "approve") {
          response = await ctx.state.bridgeApi.review.approve(requestPayload);
        } else if (ctx.state.pendingAction.type === "reject") {
          response = await ctx.state.bridgeApi.review.reject({
            submissionId: ctx.state.currentSubmissionId,
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            requestId: requestPayload.requestId,
            expectedVersion: requestPayload.expectedVersion,
            reasonCode: ctx.state.pendingAction.payload.reasonCode,
            notes: ctx.state.pendingAction.payload.notes,
          });
        } else {
          response = await ctx.state.bridgeApi.review.reopen(requestPayload);
        }
      } catch (error) {
        response = { ok: false, error: { message: error.message } };
      }

      closeModal("review-confirm-modal");

      if (!response || !response.ok) {
        if (typeof ctx.showFeedback === "function") {
          ctx.showFeedback(response && response.error ? response.error.message : "Review action failed.", "error");
        }
        ctx.state.pendingAction = null;
        return;
      }

      var actionLabel = ctx.state.pendingAction.type === "approve" ? "approved" : ctx.state.pendingAction.type === "reject" ? "rejected" : "re-opened";
      if (typeof ctx.showToast === "function") {
        ctx.showToast("Submission " + actionLabel + ".", "success");
      }
      ctx.state.pendingAction = null;
      await loadSubmission(ctx.state.currentSubmissionId);
      if (getRuntimeGlobal().reviewConsoleStore) {
        getRuntimeGlobal().reviewConsoleStore.requestQueueRefresh();
      }
    }

    function wireActions() {
      var doc = getDocument();
      var approveBtn = doc.getElementById("review-action-approve");
      if (approveBtn) {
        approveBtn.addEventListener("click", function () {
          queueAction("approve", { notes: "Approved from review console." });
        });
      }

      var rejectBtn = doc.getElementById("review-action-reject");
      if (rejectBtn) {
        rejectBtn.addEventListener("click", function () {
          resetRejectForm();
          openModal("review-reject-modal");
        });
      }

      var reopenBtn = doc.getElementById("review-action-reopen");
      if (reopenBtn) {
        reopenBtn.addEventListener("click", function () {
          queueAction("reopen", { notes: "Re-opened for amendment." });
        });
      }

      var rejectSubmit = doc.getElementById("review-reject-submit");
      if (rejectSubmit) {
        rejectSubmit.addEventListener("click", function () {
          var payload = readRejectFormPayload();
          if (payload.reasonMissing || payload.notesMissing) {
            showRejectValidation(
              "Reject reason code and reviewer notes are required before continuing.",
              payload.reasonMissing,
              payload.notesMissing
            );
            if (typeof ctx.showFeedback === "function") {
              ctx.showFeedback("Reject reason and notes are required.", "warning");
            }
            return;
          }
          resetRejectValidationState();
          closeModal("review-reject-modal");
          queueAction("reject", { reasonCode: payload.reasonCode, notes: payload.notes });
        });
      }

      var rejectCancel = doc.getElementById("review-reject-cancel");
      if (rejectCancel) {
        rejectCancel.addEventListener("click", function () {
          resetRejectValidationState();
          closeModal("review-reject-modal");
        });
      }

      var confirmCancel = doc.getElementById("review-confirm-cancel");
      if (confirmCancel) {
        confirmCancel.addEventListener("click", function () {
          ctx.state.pendingAction = null;
          closeModal("review-confirm-modal");
        });
      }

      var confirmSubmit = doc.getElementById("review-confirm-submit");
      if (confirmSubmit) {
        confirmSubmit.addEventListener("click", function () {
          void executePendingAction();
        });
      }

      var addTagBtn = doc.getElementById("review-add-tag-btn");
      if (addTagBtn) {
        addTagBtn.addEventListener("click", function () {
          void addTag();
        });
      }

      var addFlagBtn = doc.getElementById("review-add-flag-btn");
      if (addFlagBtn) {
        addFlagBtn.addEventListener("click", function () {
          void addFlag();
        });
      }

      var reloadBtn = doc.getElementById("review-detail-reload");
      if (reloadBtn) {
        reloadBtn.addEventListener("click", function () {
          void loadSubmission(ctx.state.currentSubmissionId);
        });
      }

      var rejectReasonInput = doc.getElementById("review-reject-reason");
      if (rejectReasonInput) {
        rejectReasonInput.addEventListener("change", function () {
          resetRejectValidationState();
        });
      }

      var rejectNotesInput = doc.getElementById("review-reject-notes");
      if (rejectNotesInput) {
        rejectNotesInput.addEventListener("input", function () {
          resetRejectValidationState();
        });
      }

      if (getRuntimeGlobal() && typeof getRuntimeGlobal().addEventListener === "function") {
        getRuntimeGlobal().addEventListener("keydown", function (event) {
          if (!ctx.state.activeModalId) {
            return;
          }
          if (event.key === "Tab") {
            var activeModal = getDocument().getElementById(ctx.state.activeModalId);
            var focusables = getModalFocusableElements(activeModal);
            if (focusables.length > 0) {
              var first = focusables[0];
              var last = focusables[focusables.length - 1];
              var active = getDocument().activeElement;
              if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
              }
            }
            return;
          }
          if (event.key !== "Escape") {
            return;
          }
          event.preventDefault();
          if (ctx.state.activeModalId === "review-confirm-modal") {
            ctx.state.pendingAction = null;
          }
          if (ctx.state.activeModalId === "review-reject-modal") {
            resetRejectValidationState();
          }
          closeModal(ctx.state.activeModalId);
        });
      }
    }

    function wire(options) {
      ctx.state.bridgeApi = options && options.api ? options.api : null;
      wireActions();

      if (getRuntimeGlobal() && typeof getRuntimeGlobal().addEventListener === "function") {
        getRuntimeGlobal().addEventListener("review:selection-changed", function (event) {
          var submissionId = event && event.detail ? event.detail.submissionId : null;
          if (submissionId) {
            void loadSubmission(submissionId);
          }
        });
        getRuntimeGlobal().addEventListener("review:actor-updated", function () {
          if (ctx.state.currentSubmissionId) {
            void loadSubmission(ctx.state.currentSubmissionId);
          }
        });
      }

      if (getRuntimeGlobal().reviewConsoleStore && getRuntimeGlobal().reviewConsoleStore.getSelectedSubmissionId) {
        var selection = getRuntimeGlobal().reviewConsoleStore.getSelectedSubmissionId();
        if (selection) {
          void loadSubmission(selection);
        }
      }
    }

    return {
      loadSubmission: loadSubmission,
      addTag: addTag,
      addFlag: addFlag,
      queueAction: queueAction,
      executePendingAction: executePendingAction,
      wireActions: wireActions,
      wire: wire,
      openModal: openModal,
      closeModal: closeModal,
      resetRejectValidationState: resetRejectValidationState,
      resetRejectForm: resetRejectForm,
      showRejectValidation: showRejectValidation,
      readRejectFormPayload: readRejectFormPayload,
      getModalFocusableElements: getModalFocusableElements,
    };
  }

  return {
    createReviewDetailActions: createReviewDetailActions,
  };
});
