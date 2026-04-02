/* Review Queue state helpers for PRD-08 queue triage. */
(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.reviewQueueState = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function createReviewQueueState() {
    function getSeverityRank(value) {
      var normalized = String(value || "").toLowerCase();
      if (normalized === "critical") {
        return 4;
      }
      if (normalized === "high") {
        return 3;
      }
      if (normalized === "medium" || normalized === "moderate") {
        return 2;
      }
      if (normalized === "low") {
        return 1;
      }
      return 0;
    }

    function getRiskRank(item) {
      var flags = Array.isArray(item && item.flags) ? item.flags : [];
      if (flags.length === 0) {
        return 0;
      }

      var maxRank = 0;
      for (var index = 0; index < flags.length; index += 1) {
        var rank = getSeverityRank(flags[index] && flags[index].severity);
        if (rank > maxRank) {
          maxRank = rank;
        }
      }
      return maxRank;
    }

    function getRiskLabel(item) {
      var rank = getRiskRank(item);
      if (rank >= 3) {
        return "High";
      }
      if (rank === 2) {
        return "Medium";
      }
      if (rank === 1) {
        return "Low";
      }
      return "None";
    }

    function stateMatches(item, stateFilter) {
      if (!stateFilter) {
        return true;
      }
      return String(item && item.state || "").toLowerCase() === String(stateFilter).toLowerCase();
    }

    function ageMatches(item, ageBucket) {
      if (!ageBucket) {
        return true;
      }
      var age = Number(item && item.ageDays);
      if (!Number.isFinite(age)) {
        age = 0;
      }

      if (ageBucket === "0-2") {
        return age <= 2;
      }
      if (ageBucket === "3-7") {
        return age >= 3 && age <= 7;
      }
      if (ageBucket === "8+") {
        return age >= 8;
      }
      return true;
    }

    function riskMatches(item, riskLevel) {
      if (!riskLevel) {
        return true;
      }
      var rank = getRiskRank(item);
      if (riskLevel === "high") {
        return rank >= 3;
      }
      if (riskLevel === "medium") {
        return rank === 2;
      }
      if (riskLevel === "low") {
        return rank === 1;
      }
      if (riskLevel === "none") {
        return rank === 0;
      }
      return true;
    }

    function submittedAtForSort(item) {
      var parsed = new Date(item && item.submittedAt ? item.submittedAt : 0);
      if (isNaN(parsed.getTime())) {
        return "9999-12-31T23:59:59.999Z";
      }
      return parsed.toISOString();
    }

    function sortForTriage(items) {
      return (Array.isArray(items) ? items.slice() : []).sort(function (left, right) {
        var riskDiff = getRiskRank(right) - getRiskRank(left);
        if (riskDiff !== 0) {
          return riskDiff;
        }

        var leftAge = Number(left && left.ageDays);
        var rightAge = Number(right && right.ageDays);
        if (!Number.isFinite(leftAge)) {
          leftAge = 0;
        }
        if (!Number.isFinite(rightAge)) {
          rightAge = 0;
        }
        if (rightAge !== leftAge) {
          return rightAge - leftAge;
        }

        var leftSubmitted = submittedAtForSort(left);
        var rightSubmitted = submittedAtForSort(right);
        if (leftSubmitted < rightSubmitted) {
          return -1;
        }
        if (leftSubmitted > rightSubmitted) {
          return 1;
        }

        var leftId = String(left && left.submissionId ? left.submissionId : "");
        var rightId = String(right && right.submissionId ? right.submissionId : "");
        if (leftId < rightId) {
          return -1;
        }
        if (leftId > rightId) {
          return 1;
        }
        return 0;
      });
    }

    function applyClientFilters(items, filters) {
      var normalized = filters || {};
      return sortForTriage(items).filter(function (item) {
        return stateMatches(item, normalized.state)
          && ageMatches(item, normalized.ageBucket)
          && riskMatches(item, normalized.riskLevel);
      });
    }

    function isBackendUnreachable(errorLike) {
      var reason = String((errorLike && errorLike.reason) || "").toLowerCase();
      var message = String((errorLike && errorLike.message) || "").toLowerCase();
      return (
        reason.indexOf("backend_unreachable") !== -1 ||
        message.indexOf("backend") !== -1 ||
        message.indexOf("network") !== -1 ||
        message.indexOf("fetch") !== -1 ||
        message.indexOf("unreachable") !== -1
      );
    }

    function resolveQueueState(options) {
      var hasItems = Boolean(options && options.hasItems);
      var backendUnreachable = Boolean(options && options.backendUnreachable);
      if (backendUnreachable && hasItems) {
        return {
          tone: "warning",
          feedback: "Showing last loaded review queue. Backend is unreachable; retry when API service is back.",
          emptyMessage: "No submissions in review queue. Under-review packs will appear here.",
        };
      }
      if (backendUnreachable) {
        return {
          tone: "error",
          feedback: "Review queue unavailable because backend is unreachable. Start API service, then retry.",
          emptyMessage: "Review queue unavailable because backend is unreachable. Start API service, then retry.",
        };
      }
      if (hasItems) {
        return {
          tone: "warning",
          feedback: "Showing last loaded review queue. Latest refresh failed; retry to sync.",
          emptyMessage: "No submissions in review queue. Under-review packs will appear here.",
        };
      }
      return {
        tone: "error",
        feedback: "Failed to load review queue. Retry after confirming backend health.",
        emptyMessage: "Unable to load review queue. Retry after confirming backend health.",
      };
    }

    return {
      getRiskRank: getRiskRank,
      getRiskLabel: getRiskLabel,
      sortForTriage: sortForTriage,
      applyClientFilters: applyClientFilters,
      isBackendUnreachable: isBackendUnreachable,
      resolveQueueState: resolveQueueState,
    };
  }

  return {
    createReviewQueueState: createReviewQueueState,
  };
});
