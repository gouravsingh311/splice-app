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

  toggle(name, force) {
    if (force === undefined) {
      if (this.names.has(name)) {
        this.names.delete(name);
      } else {
        this.names.add(name);
      }
    } else if (force) {
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
    this.innerHTML = "";
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.listeners = {};
    this.classList = new FakeClassList(this);
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }
}

function buildHarness() {
  const ids = [
    "actor-id",
    "actor-roles",
    "environment-name",
    "health-port",
    "electron-version",
    "chrome-version",
    "sidebar-version",
    "qc-submission-id",
    "qc-pack-name",
    "qc-folders",
    "qc-audio-zip-name",
    "qc-audio-zip-size",
    "qc-sample-count",
    "qc-unsupported-tokens",
    "qc-run-button",
    "qc-rules-button",
    "qc-policy-button",
    "qc-policy-save-button",
    "qc-report-submission-selector",
    "qc-report-run-selector",
    "qc-report-severity-filter",
    "qc-report-category-filter",
    "qc-report-rerun-button",
    "qc-report-export-button",
    "qc-report-feedback",
    "qc-results-summary",
    "qc-report-blocking-count",
    "qc-report-warning-count",
    "qc-report-pass-fail",
    "qc-report-resolved-summary",
    "qc-results-findings",
    "qc-feedback",
    "qc-rules-output",
    "qc-report-summary",
  ];

  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  elements.get("qc-report-severity-filter").value = "all";
  elements.get("qc-report-category-filter").value = "all";
  elements.get("qc-submission-id").value = "sub-local-1";

  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
    createElement() {
      return new FakeElement("created");
    },
  };

  return { document, elements };
}

async function fire(element, type) {
  const handlers = element.listeners[type] || [];
  for (const handler of handlers) {
    await handler({ preventDefault() {} });
  }
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("renderer QC report supports switching submissions and historical runs", async () => {
  const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
  const { document, elements } = buildHarness();

  const qcDataBySubmission = {
    "sub-a": {
      ok: true,
      data: {
        runId: "req-a-2",
        status: "failed",
        startedAt: "2026-03-03T00:02:00.000Z",
        completedAt: "2026-03-03T00:02:30.000Z",
        findings: [],
        history: [
          {
            runId: "req-a-1",
            status: "failed",
            startedAt: "2026-03-03T00:01:00.000Z",
            completedAt: "2026-03-03T00:01:30.000Z",
            findings: [],
          },
          {
            runId: "req-a-2",
            status: "failed",
            startedAt: "2026-03-03T00:02:00.000Z",
            completedAt: "2026-03-03T00:02:30.000Z",
            findings: [],
          },
        ],
      },
    },
    "sub-b": {
      ok: true,
      data: {
        runId: "req-b-1",
        status: "failed",
        startedAt: "2026-03-03T00:03:00.000Z",
        completedAt: "2026-03-03T00:03:30.000Z",
        findings: [],
        history: [
          {
            runId: "req-b-1",
            status: "failed",
            startedAt: "2026-03-03T00:03:00.000Z",
            completedAt: "2026-03-03T00:03:30.000Z",
            findings: [],
          },
        ],
      },
    },
  };

  global.document = document;
  global.window = {
    authUiState: {},
    splice: {
      system: {
        versions: { electron: "40.6.0", chrome: "144.0.0.0" },
        runtime: { environment: "local", healthPort: 4815 },
      },
      auth: {
        async getSession() {
          return {
            ok: true,
            data: {
              actor: { id: "creator-1", roles: ["creator"] },
              permissions: [],
              sessionIssuedAt: "2026-03-03T00:00:00.000Z",
            },
          };
        },
      },
      submissions: {
        async list() {
          return {
            ok: true,
            data: {
              submissions: [
                {
                  submissionId: "sub-a",
                  packName: "Pack A",
                  updatedAt: "2026-03-03T00:02:30.000Z",
                },
                {
                  submissionId: "sub-b",
                  packName: "Pack B",
                  updatedAt: "2026-03-03T00:03:30.000Z",
                },
              ],
            },
          };
        },
      },
      qc: {
        async getResults(payload) {
          return qcDataBySubmission[payload.submissionId] || { ok: true, data: { runId: null, status: "not_run", startedAt: null, completedAt: null, findings: [], history: [] } };
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
          return { ok: true, data: { events: [] } };
        },
      },
    },
  };

  delete require.cache[rendererPath];
  require(rendererPath);
  await flush();

  assert.match(elements.get("qc-report-submission-selector").innerHTML, /sub-a/);
  assert.match(elements.get("qc-report-submission-selector").innerHTML, /sub-b/);

  elements.get("qc-report-submission-selector").value = "sub-a";
  await fire(elements.get("qc-report-submission-selector"), "change");
  await flush();

  assert.match(elements.get("qc-report-run-selector").innerHTML, /req-a-1/);
  assert.match(elements.get("qc-report-run-selector").innerHTML, /req-a-2/);

  elements.get("qc-report-run-selector").value = "req-a-1";
  await fire(elements.get("qc-report-run-selector"), "change");
  await flush();
  assert.match(elements.get("qc-results-summary").textContent, /Run req-a-1/);

  elements.get("qc-report-submission-selector").value = "sub-b";
  await fire(elements.get("qc-report-submission-selector"), "change");
  await flush();
  assert.match(elements.get("qc-report-run-selector").innerHTML, /req-b-1/);
  assert.doesNotMatch(elements.get("qc-report-run-selector").innerHTML, /req-a-2/);

  delete global.window;
  delete global.document;
});

test("renderer QC report differentiates empty history from unreachable backend", async () => {
  const rendererPath = path.join(__dirname, "..", "src", "renderer.js");
  const { document, elements } = buildHarness();

  global.document = document;
  global.window = {
    authUiState: {},
    splice: {
      auth: {
        async getSession() {
          return {
            ok: true,
            data: {
              actor: { id: "creator-2", roles: ["creator"] },
              permissions: [],
              sessionIssuedAt: "2026-03-03T00:00:00.000Z",
            },
          };
        },
      },
      submissions: {
        async list() {
          return {
            ok: true,
            data: {
              submissions: [
                { submissionId: "sub-empty", packName: "Empty Pack", updatedAt: "2026-03-03T01:00:00.000Z" },
                { submissionId: "sub-down", packName: "Offline Pack", updatedAt: "2026-03-03T00:00:00.000Z" },
              ],
            },
          };
        },
      },
      qc: {
        async getResults(payload) {
          if (payload.submissionId === "sub-down") {
            return {
              ok: false,
              error: {
                code: "INTERNAL_ERROR",
                reason: "QC_BACKEND_UNREACHABLE:connect ECONNREFUSED",
                message: "QC backend is unavailable",
              },
            };
          }
          return {
            ok: true,
            data: {
              runId: null,
              status: "not_run",
              startedAt: null,
              completedAt: null,
              findings: [],
              history: [],
            },
          };
        },
      },
    },
  };

  delete require.cache[rendererPath];
  require(rendererPath);
  await flush();

  elements.get("qc-report-submission-selector").value = "sub-empty";
  await fire(elements.get("qc-report-submission-selector"), "change");
  await flush();
  assert.match(elements.get("qc-results-summary").textContent, /No QC runs found for this submission/);

  elements.get("qc-report-submission-selector").value = "sub-down";
  await fire(elements.get("qc-report-submission-selector"), "change");
  await flush();
  assert.match(
    elements.get("qc-results-summary").textContent,
    /(QC results are unavailable right now|QC history unavailable because the backend is unreachable)/i,
  );
  assert.match(elements.get("qc-report-feedback").textContent, /Next step:/i);

  delete global.window;
  delete global.document;
});
