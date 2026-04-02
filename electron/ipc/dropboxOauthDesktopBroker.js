const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { URL } = require("node:url");

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 53682;
const CALLBACK_PATH = "/dropbox/oauth/callback";
const SESSION_TTL_MS = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function createDropboxOauthDesktopBroker(options = {}) {
  const operationsBackendClient = options.operationsBackendClient;
  const openExternal =
    typeof options.openExternal === "function" ? options.openExternal : async () => {};
  const logger = options.logger || console;
  const sessions = new Map();

  if (!operationsBackendClient) {
    throw new Error("operationsBackendClient is required for Dropbox OAuth desktop broker");
  }

  function finalizeSession(session, updates) {
    const next = { ...session, ...updates };
    sessions.set(session.sessionId, next);
    if (next.server) {
      next.server.close();
      next.server = null;
    }
    return next;
  }

  function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.createdAtMs > SESSION_TTL_MS) {
        finalizeSession(session, {
          status: "expired",
          message: "OAuth session expired. Start again.",
        });
        sessions.set(sessionId, { ...sessions.get(sessionId), server: null });
      }
    }
  }

  function findPendingSessionForActor(actorId) {
    for (const session of sessions.values()) {
      if (session.actorId === actorId && session.status === "pending" && session.server) {
        return session;
      }
    }
    return null;
  }

  async function startSession(payload) {
    cleanupExpiredSessions();
    const existing = findPendingSessionForActor(payload.actorId);
    if (existing) {
      try {
        await openExternal(existing.authorizeUrl);
      } catch (_error) {
        // Session already active; caller can still continue OAuth with existing URL.
      }
      return {
        sessionId: existing.sessionId,
        status: "pending",
        authorizeUrl: existing.authorizeUrl,
        startedAt: existing.startedAt,
      };
    }

    const sessionId = randomUUID();
    const state = `splice-${randomUUID()}`;
    const startedAt = nowIso();
    const createdAtMs = Date.now();
    const baseResponse = await operationsBackendClient.startDropboxOauth({
      actorId: payload.actorId,
      actorRole: payload.actorRole,
      appKey: payload.appKey || null,
    });
    const baseAuthorizeUrl = String(baseResponse?.authorizeUrl || "").trim();
    if (!baseAuthorizeUrl) {
      throw new Error("Dropbox OAuth authorize URL is missing.");
    }

    const server = http.createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(CALLBACK_PORT, CALLBACK_HOST, resolve);
      });
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : "";
      if (code === "EADDRINUSE") {
        throw new Error(
          `Dropbox OAuth callback port ${CALLBACK_PORT} is already in use. Close the other process and retry.`
        );
      }
      throw error;
    }
    const redirectUri = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

    const authorizeUrl = new URL(baseAuthorizeUrl);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("token_access_type", "offline");

    const session = {
      sessionId,
      actorId: payload.actorId,
      actorRole: payload.actorRole,
      appKey: payload.appKey || null,
      appSecret: payload.appSecret || null,
      state,
      redirectUri,
      createdAtMs,
      startedAt,
      status: "pending",
      message: "Waiting for Dropbox authorization callback.",
      accountId: null,
      configuredAt: null,
      authorizeUrl: authorizeUrl.toString(),
      server,
    };
    sessions.set(sessionId, session);

    server.on("request", async (req, res) => {
      try {
        const requestUrl = new URL(req.url || "/", redirectUri);
        if (requestUrl.pathname !== CALLBACK_PATH) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const callbackState = requestUrl.searchParams.get("state") || "";
        if (callbackState !== state) {
          finalizeSession(session, {
            status: "failed",
            message: "OAuth state mismatch. Please retry.",
          });
          res.statusCode = 400;
          res.end("Invalid callback state.");
          return;
        }
        const callbackError = requestUrl.searchParams.get("error_description")
          || requestUrl.searchParams.get("error")
          || "";
        if (callbackError) {
          finalizeSession(session, {
            status: "failed",
            message: `Dropbox authorization failed: ${callbackError}`,
          });
          res.statusCode = 400;
          res.end("Dropbox authorization failed.");
          return;
        }
        const code = requestUrl.searchParams.get("code") || "";
        if (!code) {
          finalizeSession(session, {
            status: "failed",
            message: "Dropbox callback missing authorization code.",
          });
          res.statusCode = 400;
          res.end("Missing authorization code.");
          return;
        }

        const completeResponse = await operationsBackendClient.completeDropboxOauth({
          actorId: session.actorId,
          actorRole: session.actorRole,
          authCode: code,
          appKey: session.appKey || null,
          appSecret: session.appSecret || null,
          redirectUri: session.redirectUri,
        });
        finalizeSession(session, {
          status: "completed",
          message: "Dropbox connected successfully.",
          accountId: completeResponse?.accountId || null,
          configuredAt: completeResponse?.configuredAt || nowIso(),
        });
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end("<h2>Dropbox connected</h2><p>You can return to the app.</p>");
      } catch (error) {
        logger.error("Dropbox desktop OAuth callback failed", { error: error.message });
        finalizeSession(session, {
          status: "failed",
          message: error?.message || "Dropbox OAuth callback failed.",
        });
        res.statusCode = 500;
        res.end("Dropbox OAuth callback failed.");
      }
    });

    try {
      await openExternal(authorizeUrl.toString());
    } catch (error) {
      finalizeSession(session, {
        status: "failed",
        message: `Unable to open browser: ${error?.message || "openExternal failed"}`,
      });
      throw error;
    }

    return {
      sessionId,
      status: "pending",
      authorizeUrl: session.authorizeUrl,
      startedAt,
    };
  }

  async function getStatus(payload) {
    cleanupExpiredSessions();
    const session = sessions.get(payload.sessionId);
    if (!session || session.actorId !== payload.actorId) {
      return {
        sessionId: payload.sessionId,
        status: "expired",
        message: "OAuth session not found. Start again.",
        accountId: null,
        configuredAt: null,
      };
    }
    return {
      sessionId: session.sessionId,
      status: session.status,
      message: session.message,
      accountId: session.accountId || null,
      configuredAt: session.configuredAt || null,
    };
  }

  return Object.freeze({
    startSession,
    getStatus,
  });
}

module.exports = {
  createDropboxOauthDesktopBroker,
};
