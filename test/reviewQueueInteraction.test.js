const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.innerHTML = "";
    this.textContent = "";
    this.className = "";
    this.listeners = {};
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }
}

test("review queue opens detail only from explicit Open Review button", async () => {
  const pagePath = path.join(__dirname, "..", "src", "renderer", "features", "review", "review-queue-page.js");

  const elements = new Map();
  [
    "review-queue-feedback",
    "review-queue-tbody",
    "review-queue-refresh",
    "review-queue-state-filter",
    "review-queue-tag-filter",
    "review-queue-flag-filter",
  ].forEach((id) => {
    elements.set(id, new FakeElement(id));
  });

  let navClicks = 0;
  let selectedSubmissionId = null;

  global.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector(selector) {
      if (selector === '[data-nav="reviewer-decision"]') {
        return {
          click() {
            navClicks += 1;
          },
        };
      }
      return null;
    },
  };

  global.reviewConsoleStore = {
    getActor() {
      return { actorId: "reviewer-test", actorRole: "reviewer" };
    },
    setSelectedSubmissionId(submissionId) {
      selectedSubmissionId = submissionId;
    },
    setQueueItems() {},
  };

  global.addEventListener = () => {};

  delete require.cache[pagePath];
  require(pagePath);

  await global.reviewQueuePage.wire({
    api: {
      review: {
        async listQueue() {
          return {
            ok: true,
            data: {
              items: [
                {
                  submissionId: "sub-open-1",
                  packName: "Demo Pack",
                  creatorId: "creator-1",
                  submittedAt: "2026-03-11T10:00:00.000Z",
                  state: "under_review",
                  ageDays: 2,
                },
              ],
            },
          };
        },
      },
    },
  });

  const tbody = elements.get("review-queue-tbody");
  const clickHandler = tbody.listeners.click[0];

  await clickHandler({
    target: {
      closest(selector) {
        if (selector === "[data-open-review-detail]") {
          return null;
        }
        return null;
      },
    },
  });

  assert.equal(selectedSubmissionId, null);
  assert.equal(navClicks, 0);

  await clickHandler({
    target: {
      closest(selector) {
        if (selector === "[data-open-review-detail]") {
          return {
            getAttribute(name) {
              if (name === "data-open-review-detail") {
                return "sub-open-1";
              }
              return null;
            },
          };
        }
        return null;
      },
    },
  });

  assert.equal(selectedSubmissionId, "sub-open-1");
  assert.equal(navClicks, 1);

  delete global.document;
  delete global.reviewConsoleStore;
  delete global.addEventListener;
  delete global.reviewQueuePage;
});
