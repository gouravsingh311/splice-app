const { IPC_CHANNELS, buildIpcErrorResponse, buildIpcSuccessResponse, getContract, formatZodIssues } = require("./contracts");
const { BrowserWindow } = require("electron");
const {
  handleAiAudioStart,
  handleAiAudioStop,
  handleAiAudioStatus,
  registerAiAudioCallbacks,
} = require("./handlers/aiAudio");

function isTrustedSender(metadata, options = {}) {
  return true; // Simplified for stub
}

function resolvePrimaryActorRole() {
  return "creator";
}

function applyActorContextToPayload(payload, actorContext) {
  return payload;
}

function createIpcRouter(options = {}) {
  let isPrivacyShieldEnabled = options.enableScreenShield ?? true;

  // --- Register AI audio push-event relay ---
  // When FastAPI sends ACK / status events through the WS, forward them to all renderer windows.
  registerAiAudioCallbacks({
    onAck: (ackMsg) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.AI_AUDIO_ACK, { ok: true, data: ackMsg });
        }
      });
    },
    onStatus: (statusMsg) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.AI_AUDIO_ACK, { ok: true, data: { event: "connection_status", ...statusMsg } });
        }
      });
    },
  });

  const handlers = {
    [IPC_CHANNELS.DESKTOP_VERIFY_SECURITY]: () => {
      const verifySecurityConfig = options.verifySecurityConfig || (() => ({
        checks: { contextIsolation: true, nodeIntegration: false, sandbox: true, navigationGuard: true },
      }));
      return verifySecurityConfig();
    },
    [IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_TOGGLE]: async ({ request, event }) => {
      const { enabled } = request;
      const win = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null;
      if (win && !win.isDestroyed() && (process.platform === "win32" || process.platform === "darwin")) {
        win.setContentProtection(enabled);
        win.setSkipTaskbar(enabled);
        isPrivacyShieldEnabled = enabled;
        return { success: true, enabled: isPrivacyShieldEnabled };
      }
      return { success: false, enabled: isPrivacyShieldEnabled };
    },
    [IPC_CHANNELS.DESKTOP_PRIVACY_SHIELD_STATUS]: async () => {
      return { enabled: isPrivacyShieldEnabled };
    },
    // --- AI: Audio Streaming ---
    [IPC_CHANNELS.AI_AUDIO_START]: async ({ request }) => handleAiAudioStart(request),
    [IPC_CHANNELS.AI_AUDIO_STOP]: async ({ request }) => handleAiAudioStop(request?.sessionId),
    [IPC_CHANNELS.AI_AUDIO_STATUS]: async () => handleAiAudioStatus(),
  };

  async function invoke(channel, payload, metadata = {}) {
    try {
      const handler = handlers[channel];
      if (!handler) {
        return buildIpcErrorResponse(channel, "UNKNOWN_CHANNEL", "CHANNEL_NOT_REGISTERED", "IPC channel is not registered");
      }
      const responseData = await handler({ request: payload, event: metadata.event });
      const successResponse = buildIpcSuccessResponse(responseData);
      return successResponse;
    } catch (error) {
      return buildIpcErrorResponse(channel, "INTERNAL_ERROR", "HANDLER_EXCEPTION", "IPC handler failed");
    }
  }

  function registerHandlers(ipcMain) {
    for (const channelName of Object.keys(IPC_CHANNELS)) {
      const channel = IPC_CHANNELS[channelName];
      ipcMain.handle(channel, async (event, payload) => {
        const metadata = {
          event,
          senderUrl: event.senderFrame?.url || null,
          topFrameUrl: event.sender?.getURL() || null,
          senderWebContentsId: event.sender?.id || null,
        };
        const responseData = await invoke(channel, payload, metadata);
        return responseData;
      });
    }
  }

  return { registerHandlers, invoke };
}

module.exports = { createIpcRouter, isTrustedSender, applyActorContextToPayload, resolvePrimaryActorRole };
