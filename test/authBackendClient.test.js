const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AuthBackendClientError,
  createAuthBackendClient,
} = require("../electron/ipc/authBackendClient");

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("auth backend client maps login response to renderer-safe camelCase payload", async () => {
  const client = createAuthBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(200, {
        access_token: "access-token",
        access_token_expires_at: "2026-02-25T00:15:00.000Z",
        refresh_token: "refresh-token",
        refresh_token_expires_at: "2026-03-26T00:00:00.000Z",
        user: {
          id: "user_1",
          email: "creator@example.com",
          roles: ["creator"],
          permissions: ["submission:create"],
          status: "active",
          created_at: "2026-02-25T00:00:00.000Z",
          updated_at: "2026-02-25T00:00:00.000Z",
        },
      }),
  });

  const result = await client.login({
    email: "creator@example.com",
    password: "StrongPassword!123",
  });

  assert.equal(result.accessToken, "access-token");
  assert.equal(result.user.roles[0], "creator");
  assert.equal(result.user.createdAt, "2026-02-25T00:00:00.000Z");
});

test("auth backend client forwards PRD-01 auth service error codes", async () => {
  const client = createAuthBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(423, {
        error: {
          code: "AUTH_LOCKED",
          message: "Account temporarily locked",
          status: 423,
        },
      }),
  });

  await assert.rejects(
    client.login({
      email: "creator@example.com",
      password: "StrongPassword!123",
    }),
    (error) =>
      error instanceof AuthBackendClientError &&
      error.code === "AUTH_LOCKED" &&
      error.reason === "AUTH_SERVICE_ERROR:423"
  );
});

test("auth backend client converts FastAPI validation detail into validation error", async () => {
  const client = createAuthBackendClient({
    baseUrl: "http://127.0.0.1:8017",
    fetchImpl: async () =>
      createJsonResponse(422, {
        detail: [
          {
            loc: ["body", "email"],
            msg: "Field required",
          },
        ],
      }),
  });

  await assert.rejects(
    client.forgotPassword({
      email: "",
    }),
    (error) =>
      error instanceof AuthBackendClientError &&
      error.code === "VALIDATION_ERROR" &&
      /body\.email/.test(error.reason)
  );
});
