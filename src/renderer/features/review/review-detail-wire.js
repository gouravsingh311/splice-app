/* Review Detail wiring/event handlers for PRD-08 decision flow. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewDetailWire = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createReviewDetailWire(ctx) {
    function getDocument() {
      return typeof ctx.getDocument === "function" ? ctx.getDocument() : null;
    }

    function getRuntimeGlobal() {
      return typeof ctx.getRuntimeGlobal === "function" ? ctx.getRuntimeGlobal() : (typeof globalThis !== "undefined" ? globalThis : {});
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

    function wireEvents() {
      var doc = getDocument();
      if (!doc) {
        return;
      }

      var approveBtn = doc.getElementById("review-action-approve");
      if (approveBtn) {
        approveBtn.addEventListener("click", function () {
          ctx.queueAction("approve", { notes: "Approved from review console." });
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
          ctx.queueAction("reopen", { notes: "Re-opened for amendment." });
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
          ctx.queueAction("reject", { reasonCode: payload.reasonCode, notes: payload.notes });
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
          void ctx.executePendingAction();
        });
      }

      var addTagBtn = doc.getElementById("review-add-tag-btn");
      if (addTagBtn) {
        addTagBtn.addEventListener("click", function () {
          void ctx.addTag();
        });
      }

      var addFlagBtn = doc.getElementById("review-add-flag-btn");
      if (addFlagBtn) {
        addFlagBtn.addEventListener("click", function () {
          void ctx.addFlag();
        });
      }

      var reloadBtn = doc.getElementById("review-detail-reload");
      if (reloadBtn) {
        reloadBtn.addEventListener("click", function () {
          void ctx.loadSubmission(ctx.state.currentSubmissionId);
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
            var activeModal = doc.getElementById(ctx.state.activeModalId);
            var focusables = getModalFocusableElements(activeModal);
            if (focusables.length > 0) {
              var first = focusables[0];
              var last = focusables[focusables.length - 1];
              var active = doc.activeElement;
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
      wireEvents();

      if (getRuntimeGlobal() && typeof getRuntimeGlobal().addEventListener === "function") {
        getRuntimeGlobal().addEventListener("review:selection-changed", function (event) {
          var submissionId = event && event.detail ? event.detail.submissionId : null;
          if (submissionId) {
            void ctx.loadSubmission(submissionId);
          }
        });
        getRuntimeGlobal().addEventListener("review:actor-updated", function () {
          if (ctx.state.currentSubmissionId) {
            void ctx.loadSubmission(ctx.state.currentSubmissionId);
          }
        });
      }

      if (getRuntimeGlobal().reviewConsoleStore && getRuntimeGlobal().reviewConsoleStore.getSelectedSubmissionId) {
        var selection = getRuntimeGlobal().reviewConsoleStore.getSelectedSubmissionId();
        if (selection) {
          void ctx.loadSubmission(selection);
        }
      }
    }

    return {
      openModal: openModal,
      closeModal: closeModal,
      getModalFocusableElements: getModalFocusableElements,
      resetRejectValidationState: resetRejectValidationState,
      resetRejectForm: resetRejectForm,
      showRejectValidation: showRejectValidation,
      readRejectFormPayload: readRejectFormPayload,
      setConfirmCopy: setConfirmCopy,
      wireEvents: wireEvents,
      wire: wire,
    };
  }

  return {
    createReviewDetailWire: createReviewDetailWire,
  };
});
