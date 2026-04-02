const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.names = new Set();
  }

  add(name) {
    this.names.add(name);
    this.owner.className = Array.from(this.names).join(" ");
  }

  remove(name) {
    this.names.delete(name);
    this.owner.className = Array.from(this.names).join(" ");
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    if (force) {
      this.names.add(name);
    } else {
      this.names.delete(name);
    }
    this.owner.className = Array.from(this.names).join(" ");
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.dataset = {};
    this.disabled = false;
    this.listeners = {};
    this.children = new Map();
    this.attributes = {};
    this.optionElements = [];
    this.classList = new FakeClassList(this);
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  querySelector(selector) {
    if (selector === 'button[type="submit"]') {
      return this.children.get("submit") || null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-role-value]") {
      return this.optionElements;
    }
    return [];
  }
}

function buildDomHarness() {
  const ids = [
    "environment-name",
    "health-port",
    "actor-id",
    "actor-roles",
    "security-status",
    "audit-status",
    "electron-version",
    "chrome-version",
    "login-form",
    "login-email",
    "login-password",
    "login-feedback",
    "register-form",
    "register-email",
    "register-password",
    "register-confirm-password",
    "register-role",
    "register-role-button",
    "register-role-label",
    "register-role-menu",
    "register-otp-code",
    "register-send-otp",
    "register-verify-otp",
    "register-feedback",
    "register-otp-status",
    "forgot-form",
    "forgot-email",
    "forgot-otp-code",
    "forgot-send-otp",
    "forgot-verify-otp",
    "forgot-feedback",
    "forgot-otp-status",
    "reset-password",
    "reset-confirm-password",
    "tab-login",
    "tab-register",
    "tab-forgot",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));

  elements.get("tab-login").dataset.authTab = "login";
  elements.get("tab-register").dataset.authTab = "register";
  elements.get("tab-forgot").dataset.authTab = "forgot";

  elements.get("login-form").dataset.authView = "login";
  elements.get("register-form").dataset.authView = "register";
  elements.get("forgot-form").dataset.authView = "forgot";

  elements.get("register-role").value = "creator";
  elements.get("register-role-menu").classList.add("hidden");

  const creatorOption = new FakeElement("role-creator");
  creatorOption.dataset.roleValue = "creator";
  const reviewerOption = new FakeElement("role-reviewer");
  reviewerOption.dataset.roleValue = "reviewer";
  const adminOption = new FakeElement("role-admin");
  adminOption.dataset.roleValue = "admin";
  elements.get("register-role-menu").optionElements = [creatorOption, reviewerOption, adminOption];

  const loginSubmit = new FakeElement("login-submit");
  const registerSubmit = new FakeElement("register-submit");
  const forgotSubmit = new FakeElement("forgot-submit");
  elements.get("login-form").children.set("submit", loginSubmit);
  elements.get("register-form").children.set("submit", registerSubmit);
  elements.get("forgot-form").children.set("submit", forgotSubmit);

  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-auth-tab]") {
        return [elements.get("tab-login"), elements.get("tab-register"), elements.get("tab-forgot")];
      }
      if (selector === "[data-auth-view]") {
        return [elements.get("login-form"), elements.get("register-form"), elements.get("forgot-form")];
      }
      return [];
    },
  };

  return { document, elements, loginSubmit, forgotSubmit };
}

async function fireEvent(element, type, event) {
  const handlers = element.listeners[type] || [];
  for (const handler of handlers) {
    await handler(event);
  }
}

test("renderer login and forgot/reset run-path renders success feedback", async () => {
  const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
  const authUiState = require("../src/renderer/core/auth/state.js");
  const { document, elements, loginSubmit, forgotSubmit } = buildDomHarness();

  global.document = document;
  global.window = {
    authUiState,
    fileeaters: {
      system: {
        versions: { electron: "40.6.0", chrome: "144.0.0.0" },
        runtime: { environment: "local", healthPort: 4815 },
      },
      auth: {
        async getSession() {
          return {
            ok: true,
            data: {
              actor: { id: "local-dev-actor", roles: ["creator"] },
              permissions: [],
              sessionIssuedAt: "2026-02-25T00:00:00.000Z",
            },
          };
        },
        async login() {
          return {
            ok: true,
            data: {
              accessToken: "access",
              accessTokenExpiresAt: "2026-02-25T00:15:00.000Z",
              refreshToken: "refresh",
              refreshTokenExpiresAt: "2026-03-26T00:00:00.000Z",
              user: {
                id: "user_1",
                email: "creator@example.com",
                roles: ["creator"],
                permissions: ["submission:create"],
                status: "active",
                createdAt: "2026-02-25T00:00:00.000Z",
                updatedAt: "2026-02-25T00:00:00.000Z",
              },
            },
          };
        },
        async sendOtp() {
          return {
            ok: true,
            data: {
              challengeId: "otp_123",
              expiresAt: "2026-02-25T00:10:00.000Z",
              cooldownSeconds: 45,
            },
          };
        },
        async verifyOtp() {
          return {
            ok: true,
            data: {
              otpVerificationToken: "otp-token",
              expiresAt: "2026-02-25T00:15:00.000Z",
            },
          };
        },
        async forgotPassword() {
          return {
            ok: true,
            data: {
              challengeId: "otp_123",
              expiresAt: "2026-02-25T00:10:00.000Z",
              cooldownSeconds: 45,
            },
          };
        },
        async resetPassword() {
          return {
            ok: true,
            data: {
              revokedSessionCount: 2,
            },
          };
        },
      },
      desktop: {
        async verifySecurityConfig() {
          return {
            ok: true,
            data: {
              checks: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                navigationGuard: true,
              },
            },
          };
        },
      },
      audit: {
        async listSecurityEvents() {
          return {
            ok: true,
            data: {
              events: [],
            },
          };
        },
      },
    },
  };

  delete require.cache[rendererPath];
  require(rendererPath);

  elements.get("login-email").value = "creator@example.com";
  elements.get("login-password").value = "StrongPassword!123";
  await fireEvent(elements.get("login-form"), "submit", {
    preventDefault: () => {},
    currentTarget: elements.get("login-form"),
    submitter: loginSubmit,
  });
  assert.equal(elements.get("login-feedback").textContent, "Login successful.");

  elements.get("forgot-email").value = "creator@example.com";
  elements.get("reset-password").value = "StrongPassword!456";
  elements.get("reset-confirm-password").value = "StrongPassword!456";
  elements.get("forgot-otp-code").value = "123456";

  await fireEvent(elements.get("forgot-send-otp"), "click", { preventDefault: () => {} });
  await fireEvent(elements.get("forgot-verify-otp"), "click", { preventDefault: () => {} });
  await fireEvent(elements.get("forgot-form"), "submit", {
    preventDefault: () => {},
    currentTarget: elements.get("forgot-form"),
    submitter: forgotSubmit,
  });

  assert.match(elements.get("forgot-feedback").textContent, /Password reset complete/);

  delete global.window;
  delete global.document;
});
