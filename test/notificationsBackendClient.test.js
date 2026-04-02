const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NotificationsBackendClientError,
  createNotificationsBackendClient,
} = require("../electron/ipc/notificationsBackendClient");

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function headersToObject(headers) {
  return Object.fromEntries(new Headers(headers));
}

test("notifications backend client sends actor headers on scoped requests", async () => {
  const requests = [];
  const client = createNotificationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async (url, init) => {
      requests.push({
        url: String(url),
        headers: headersToObject(init.headers),
        body: init.body ? JSON.parse(init.body) : null,
      });
      return createJsonResponse(200, { notifications: [] });
    },
  });

  await client.list({
    actorId: "creator-1",
    actorRole: "creator",
    includeRead: true,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers["x-actor-id"], "creator-1");
  assert.equal(requests[0].headers["x-actor-role"], "creator");
  assert.match(requests[0].url, /actor_id=creator-1/);
  assert.match(requests[0].url, /actor_role=creator/);
  assert.equal(requests[0].body, null);
});

test("notifications backend client maps list response to renderer-safe camelCase payload", async () => {
  const client = createNotificationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, {
        notifications: [
          {
            notification_id: "ntf-1",
            type: "qc_failed",
            severity: "warning",
            status: "sent",
            channel: "in_app",
            title: "QC failed",
            message: "Fix blocking findings.",
            submission_id: "sub-1",
            read: false,
            read_at: null,
            attempts: 1,
            max_attempts: 3,
            created_at: "2026-02-27T00:00:00.000Z",
            updated_at: "2026-02-27T00:00:00.000Z",
          },
        ],
      }),
  });

  const result = await client.list({
    actorId: "creator-1",
    actorRole: "creator",
    includeRead: true,
  });

  assert.equal(result.notifications[0].notificationId, "ntf-1");
  assert.equal(result.notifications[0].submissionId, "sub-1");
});

test("notifications backend client forwards retry permission errors", async () => {
  const client = createNotificationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(403, {
        error: {
          code: "NOTIFICATION_RETRY_FORBIDDEN",
          message: "Only reviewer or admin role can retry notification dispatch.",
        },
      }),
  });

  await assert.rejects(
    client.retry({
      actorId: "creator-1",
      actorRole: "creator",
      notificationId: "ntf-3",
    }),
    (error) =>
      error instanceof NotificationsBackendClientError &&
      error.code === "NOTIFICATION_RETRY_FORBIDDEN" &&
      error.reason === "NOTIFICATIONS_SERVICE_ERROR:403"
  );
});

test("notifications backend client forwards notification scope denial errors", async () => {
  const client = createNotificationsBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(403, {
        error: {
          code: "NOTIFICATION_SCOPE_FORBIDDEN",
          message: "Notification access is outside the actor's scope.",
        },
      }),
  });

  await assert.rejects(
    client.markRead({
      actorId: "creator-1",
      actorRole: "creator",
      notificationIds: ["ntf-3"],
    }),
    (error) =>
      error instanceof NotificationsBackendClientError &&
      error.code === "NOTIFICATION_SCOPE_FORBIDDEN" &&
      error.reason === "NOTIFICATIONS_SERVICE_ERROR:403"
  );
});
