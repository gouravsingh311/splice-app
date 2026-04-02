/* Shared review console state for queue/detail pages. */
(function (global) {
  var state = {
    actorId: "desktop-local-reviewer",
    actorRole: "reviewer",
    selectedSubmissionId: null,
    queueItems: [],
  };

  function emit(eventName, detail) {
    if (!global || typeof global.dispatchEvent !== "function") {
      return;
    }
    try {
      global.dispatchEvent(new CustomEvent(eventName, { detail: detail || {} }));
    } catch (_) {
      // Ignore event failures in test/teardown environments.
    }
  }

  function resolveRole(rawRoles) {
    var roles = Array.isArray(rawRoles) ? rawRoles : [];
    if (roles.indexOf("admin") !== -1) {
      return "admin";
    }
    if (roles.indexOf("reviewer") !== -1) {
      return "reviewer";
    }
    return "creator";
  }

  var api = {
    setActor: function setActor(actor) {
      state.actorId = (actor && actor.id) || state.actorId;
      state.actorRole = resolveRole(actor && actor.roles);
      emit("review:actor-updated", { actorId: state.actorId, actorRole: state.actorRole });
    },
    getActor: function getActor() {
      return {
        actorId: state.actorId,
        actorRole: state.actorRole,
      };
    },
    setSelectedSubmissionId: function setSelectedSubmissionId(submissionId) {
      state.selectedSubmissionId = submissionId || null;
      emit("review:selection-changed", { submissionId: state.selectedSubmissionId });
    },
    getSelectedSubmissionId: function getSelectedSubmissionId() {
      return state.selectedSubmissionId;
    },
    setQueueItems: function setQueueItems(items) {
      state.queueItems = Array.isArray(items) ? items.slice() : [];
      emit("review:queue-updated", { items: state.queueItems });
    },
    getQueueItems: function getQueueItems() {
      return state.queueItems.slice();
    },
    requestQueueRefresh: function requestQueueRefresh() {
      emit("review:queue-refresh", {});
    },
  };

  if (global && typeof global === "object") {
    global.reviewConsoleStore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
