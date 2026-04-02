const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuditApiClient, createSecurityAuditLog } = require("../electron/ipc/auditLog");

test("createAuditApiClient sends append payload to backend contract", async () => {
  const requests = [];
  const client = createAuditApiClient({
    baseUrl: "http://127.0.0.1:8000",
    internalToken: "test-internal-token",
    internalSecret: "test-internal-secret",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: "7cf6f095-b1eb-4a7f-abf4-f1ce6f6eddbe",
          };
        },
      };
    },
  });

  await client.appendSecurityEvent({
    id: "ipc-sec-000001",
    channel: "splice.audit.security-events.list.v1",
    actorId: "reviewer-1",
    outcome: "denied",
    reason: "ROLE_FORBIDDEN",
    timestamp: "2026-02-25T00:00:00.000Z",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:8000/internal/audit/append");
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.action, "desktop.ipc.denied.v1");
  assert.equal(payload.entity_type, "desktop");
  assert.equal(payload.entity_id, "splice.audit.security-events.list.v1");
  assert.equal(requests[0].options.headers["X-Internal-Secret"], "test-internal-secret");
});

test("createSecurityAuditLog falls back to local events when remote read is unavailable", async () => {
  const auditLog = createSecurityAuditLog({
    now: () => "2026-02-25T00:00:00.000Z",
    remoteClient: {
      async appendSecurityEvent() {},
      async listSecurityEvents() {
        throw new Error("backend unavailable");
      },
      reportRemoteFailure() {},
    },
  });

  auditLog.append({
    channel: "splice.auth.session.get.v1",
    actorId: "creator-1",
    outcome: "allowed",
    reason: "AUTHORIZED",
  });

  const events = await auditLog.listForChannel({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, "splice.auth.session.get.v1");
  assert.equal(events[0].outcome, "allowed");
});

test("createAuditApiClient normalizes backend microsecond timestamps for IPC contract", async () => {
  const client = createAuditApiClient({
    baseUrl: "http://127.0.0.1:8000",
    internalToken: "test-internal-token",
    fetchImpl: async () => {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            events: [
              {
                id: "7cf6f095-b1eb-4a7f-abf4-f1ce6f6eddbe",
                actor_id: "reviewer-1",
                action: "desktop.ipc.allowed.v1",
                entity_id: "splice.desktop.security.verify-config.v1",
                metadata: { reason: "AUTHORIZED" },
                created_at: "2026-02-25T17:01:47.631790Z",
              },
            ],
          };
        },
      };
    },
  });

  const events = await client.listSecurityEvents({ limit: 5 });
  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, "2026-02-25T17:01:47.631Z");
});
