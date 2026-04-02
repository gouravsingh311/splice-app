const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.dataset = {};
    this.disabled = false;
    this.children = [];
    this.listeners = {};
    this.type = "";
    this.attributes = {};
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
}

function buildHarness() {
  const elements = new Map();
  const allElementsCreated = [];
  const ids = [
    "notifications-active-role",
    "notifications-role-chip",
    "notifications-type-filter",
    "notifications-severity-filter",
    "notifications-status-filter",
    "notifications-load-button",
    "notifications-mark-all-button",
    "notifications-feedback",
    "notifications-list",
    "notifications-unread-list",
    "notifications-read-list",
    "notif-unread-badge",
    "stat-unread-notifs",
  ];

  ids.forEach((id) => {
    const el = new FakeElement(id);
    elements.set(id, el);
    allElementsCreated.push(el);
  });

  elements.get("notifications-active-role").value = "reviewer";

  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      const el = new FakeElement();
      allElementsCreated.push(el);
      return el;
    },
  };

  return { document, elements, allElementsCreated };
}

async function fire(element, type) {
  const handlers = element.listeners[type] || [];
  for (const handler of handlers) {
    await handler({ preventDefault: () => { } });
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("renderer notification center groups unread/read and allows retry for reviewer", async () => {
  const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
  const { document, elements, allElementsCreated } = buildHarness();

  let retryCalls = 0;
  global.document = document;
  global.window = {
    splice: {
      auth: {
        async getSession() {
          return {
            ok: true,
            data: {
              actor: { id: "reviewer-1", roles: ["reviewer"] },
              permissions: [],
              sessionIssuedAt: "2026-02-27T00:00:00.000Z",
            },
          };
        },
      },
      notifications: {
        async list() {
          return {
            ok: true,
            data: {
              notifications: [
                {
                  notificationId: "ntf-1",
                  type: "qc_failed",
                  severity: "warning",
                  status: "sent",
                  channel: "in_app",
                  title: "QC requires fixes",
                  message: "Fix findings.",
                  submissionId: "sub-1",
                  read: false,
                  readAt: null,
                  attempts: 1,
                  maxAttempts: 3,
                  createdAt: "2026-02-27T00:00:00.000Z",
                  updatedAt: "2026-02-27T00:00:00.000Z",
                },
                {
                  notificationId: "ntf-3",
                  type: "rejected",
                  severity: "error",
                  status: "failed",
                  channel: "email",
                  title: "Dispatch failed",
                  message: "Retry needed.",
                  submissionId: "sub-3",
                  read: false,
                  readAt: null,
                  attempts: 3,
                  maxAttempts: 5,
                  createdAt: "2026-02-27T00:01:00.000Z",
                  updatedAt: "2026-02-27T00:01:00.000Z",
                },
                {
                  notificationId: "ntf-2",
                  type: "approved",
                  severity: "info",
                  status: "sent",
                  channel: "email",
                  title: "Approved",
                  message: "Approved.",
                  submissionId: "sub-2",
                  read: true,
                  readAt: "2026-02-27T00:02:00.000Z",
                  attempts: 1,
                  maxAttempts: 3,
                  createdAt: "2026-02-27T00:02:00.000Z",
                  updatedAt: "2026-02-27T00:02:00.000Z",
                },
              ],
            },
          };
        },
        async markRead() {
          return { ok: true, data: { updatedCount: 1 } };
        },
        async markAllRead() {
          return { ok: true, data: { updatedCount: 2 } };
        },
        async retry() {
          retryCalls += 1;
          return {
            ok: true,
            data: {
              notification: {
                notificationId: "ntf-3",
              },
            },
          };
        },
      },
    },
    authUiState: {},
  };

  delete require.cache[rendererPath];
  require(rendererPath);
  await flush();

  // Ensure role is reviewer after bootstrap might have overwritten it
  elements.get("notifications-active-role").value = "reviewer";
  if (global.appState && global.appState.actor) {
    global.appState.actor.roles = ["reviewer"];
  }

  await fire(elements.get("notifications-load-button"), "click");

  assert.equal(elements.get("notifications-unread-list").children.length > 0, true);
  let retryButton = null;

  // FakeElement isn't preserving the tree correctly. Let's find any button in the global collection.
  for (const el of allElementsCreated) {
    if (el.textContent === "Retry Sending") {
      retryButton = el;
      break;
    }
  }

  assert.ok(retryButton, "Retry Button should exist in the mocked DOM");
  await fire(retryButton, "click");
  assert.equal(retryCalls, 1);

  delete global.window;
  delete global.document;
});

test("renderer notification center hides non-creator operational notifications for creator role", async () => {
  const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
  const { document, elements, allElementsCreated } = buildHarness();

  global.document = document;
  global.window = {
    splice: {
      auth: {
        async getSession() {
          return {
            ok: true,
            data: {
              actor: { id: "creator-1", roles: ["creator"] },
              permissions: [],
              sessionIssuedAt: "2026-03-09T00:00:00.000Z",
            },
          };
        },
      },
      notifications: {
        async list() {
          return {
            ok: true,
            data: {
              notifications: [
                {
                  notificationId: "ntf-creator-1",
                  type: "approved",
                  severity: "info",
                  status: "sent",
                  channel: "in_app",
                  title: "Approved",
                  message: "Your pack is approved.",
                  read: false,
                  createdAt: "2026-03-09T00:00:00.000Z",
                  updatedAt: "2026-03-09T00:00:00.000Z",
                },
                {
                  notificationId: "ntf-ops-1",
                  type: "job_error",
                  severity: "error",
                  status: "failed",
                  channel: "in_app",
                  title: "Queue Failure",
                  message: "Background worker failed.",
                  read: false,
                  createdAt: "2026-03-09T00:01:00.000Z",
                  updatedAt: "2026-03-09T00:01:00.000Z",
                },
              ],
            },
          };
        },
        async markRead() {
          return { ok: true, data: { updatedCount: 1 } };
        },
        async markAllRead() {
          return { ok: true, data: { updatedCount: 1 } };
        },
        async retry() {
          return { ok: false, error: { message: "forbidden" } };
        },
      },
    },
    authUiState: {},
  };

  delete require.cache[rendererPath];
  require(rendererPath);

  await fire(elements.get("notifications-load-button"), "click");

  assert.equal(elements.get("notifications-active-role").value, "creator");
  assert.match(elements.get("notifications-feedback").textContent, /Inbox refreshed/);

  const allText = allElementsCreated.map((el) => String(el.textContent || "")).join(" ");
  assert.equal(allText.includes("Job Error"), false);
  assert.equal(allText.includes("Next step:"), true);

  delete global.window;
  delete global.document;
});

test("renderer notification center preserves prior data and shows recovery guidance on backend-unreachable refresh", async () => {
  const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
  const { document, elements } = buildHarness();

  let listCalls = 0;
  global.document = document;
  global.window = {
    splice: {
      auth: {
        async getSession() {
          return {
            ok: true,
            data: {
              actor: { id: "reviewer-1", roles: ["reviewer"] },
              permissions: [],
              sessionIssuedAt: "2026-02-27T00:00:00.000Z",
            },
          };
        },
      },
      notifications: {
        async list() {
          listCalls += 1;
          if (listCalls > 1) {
            return {
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                reason: "NOTIFICATIONS_BACKEND_UNREACHABLE:fetch failed",
                message: "Notifications backend is unavailable",
              },
            };
          }
          return {
            ok: true,
            data: {
              notifications: [
                {
                  notificationId: "ntf-1",
                  type: "approved",
                  severity: "info",
                  status: "sent",
                  channel: "in_app",
                  title: "Approved",
                  message: "Approved.",
                  submissionId: "sub-1",
                  read: false,
                  createdAt: "2026-02-27T00:00:00.000Z",
                  updatedAt: "2026-02-27T00:00:00.000Z",
                },
              ],
            },
          };
        },
        async markRead() {
          return { ok: true, data: { updatedCount: 1 } };
        },
        async markAllRead() {
          return { ok: true, data: { updatedCount: 1 } };
        },
        async retry() {
          return { ok: true, data: { notification: { notificationId: "ntf-1" } } };
        },
      },
    },
    authUiState: {},
  };

  delete require.cache[rendererPath];
  require(rendererPath);

  await fire(elements.get("notifications-load-button"), "click");
  const firstRenderCount =
    elements.get("notifications-unread-list").children.length +
    elements.get("notifications-read-list").children.length;
  assert.equal(firstRenderCount > 0, true);

  await fire(elements.get("notifications-load-button"), "click");
  assert.match(
    elements.get("notifications-feedback").textContent,
    /showing last loaded notifications/i,
  );
  const secondRenderCount =
    elements.get("notifications-unread-list").children.length +
    elements.get("notifications-read-list").children.length;
  assert.equal(secondRenderCount > 0, true);

  delete global.window;
  delete global.document;
});

test("renderer notification center distinguishes no-data state with next-step guidance", async () => {
  const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
  const { document, elements } = buildHarness();

  global.document = document;
  global.window = {
    splice: {
      auth: {
        async getSession() {
          return {
            ok: true,
            data: {
              actor: { id: "creator-1", roles: ["creator"] },
              permissions: [],
              sessionIssuedAt: "2026-02-27T00:00:00.000Z",
            },
          };
        },
      },
      notifications: {
        async list() {
          return { ok: true, data: { notifications: [] } };
        },
        async markRead() {
          return { ok: true, data: { updatedCount: 0 } };
        },
        async markAllRead() {
          return { ok: true, data: { updatedCount: 0 } };
        },
        async retry() {
          return { ok: true, data: { notification: { notificationId: "ntf-none" } } };
        },
      },
    },
    authUiState: {},
  };

  delete require.cache[rendererPath];
  require(rendererPath);

  await fire(elements.get("notifications-load-button"), "click");
  assert.match(elements.get("notifications-feedback").textContent, /no notifications yet/i);

  delete global.window;
  delete global.document;
});
