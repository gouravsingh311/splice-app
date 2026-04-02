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

  setAttribute(name, value) {
    this[name] = value;
  }

  removeAttribute(name) {
    delete this[name];
  }
}

function buildAdminDomHarness() {
  const ids = [
    "admin-policy-version-badge",
    "admin-qc-feedback",
    "admin-policy-id-input",
    "admin-policy-ruleset-input",
    "admin-policy-reason-input",
    "admin-policy-normalization-target-input",
    "admin-policy-normalization-tolerance-input",
    "admin-policy-normalization-strict-input",
    "admin-qc-rules-body",
    "admin-qc-save-policy",
    "admin-config-feedback",
    "admin-configs-body",
    "admin-integration-feedback",
    "admin-integrations-body",
    "admin-ops-history-body",
    "admin-config-new-draft",
    "admin-draft-cancel",
    "admin-draft-save",
    "admin-replay-job",
    "admin-policy-reason-input",
    "admin-config-dialog",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  elements.get("admin-qc-save-policy").textContent = "Save Policy";

  const tabQc = new FakeElement("tab-qc-rules");
  tabQc.dataset.adminTab = "qc-rules";
  const tabConfigs = new FakeElement("tab-configs");
  tabConfigs.dataset.adminTab = "configs";
  const tabIntegrations = new FakeElement("tab-integrations");
  tabIntegrations.dataset.adminTab = "integrations";

  const panelQc = new FakeElement("panel-qc-rules");
  panelQc.dataset.adminPanel = "qc-rules";
  const panelConfigs = new FakeElement("panel-configs");
  panelConfigs.dataset.adminPanel = "configs";
  const panelIntegrations = new FakeElement("panel-integrations");
  panelIntegrations.dataset.adminPanel = "integrations";

  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-admin-tab]") {
        return [tabQc, tabConfigs, tabIntegrations];
      }
      if (selector === "[data-admin-panel]") {
        return [panelQc, panelConfigs, panelIntegrations];
      }
      return [];
    },
  };

  return { document, elements };
}

async function fireEvent(element, type, event) {
  const handlers = element.listeners[type] || [];
  for (const handler of handlers) {
    await handler(event || { target: element });
  }
}

test("admin policy save flow sends policy update from admin actor and renders success feedback", async () => {
  const adminPagePath = path.join(__dirname, "..", "src", "renderer", "features", "admin", "admin-page.js");
  delete require.cache[adminPagePath];
  const adminPage = require(adminPagePath);

  const { document, elements } = buildAdminDomHarness();
  const updateCalls = [];

  global.document = document;
  global.fileeaters = {
    admin: {
      qcPolicy: {
        async get() {
          return {
            ok: true,
            data: {
              policy: {
                policyId: "default-wave2-policy",
                policyVersion: 1,
                ruleSetVersion: "2026.02.wave2-baseline",
                rules: [
                  {
                    ruleId: "DEMO_NORMALIZATION_INVALID",
                    params: {
                      target_peak_db: -1,
                      tolerance_db: 0.7,
                      strict_enforcement: false,
                    },
                  },
                ],
              },
            },
          };
        },
        async update(request) {
          updateCalls.push(request);
          return {
            ok: true,
            data: {
              policy: {
                policyId: request.policy.policyId,
                policyVersion: 2,
                ruleSetVersion: request.policy.ruleSetVersion,
                rules: request.policy.rules,
              },
            },
          };
        },
      },
      configs: {
        async list() {
          return { ok: true, data: { configs: [] } };
        },
      },
      integrations: {
        async listHealth() {
          return { ok: true, data: { integrations: [] } };
        },
      },
      ops: {
        async listHistory() {
          return { ok: true, data: { entries: [] } };
        },
      },
    },
    qc: {
      async listRules() {
        return {
          ok: true,
          data: {
            rules: [
              {
                ruleId: "DEMO_NORMALIZATION_INVALID",
                title: "Demo normalization",
                severity: "warning",
                enabled: true,
                blocking: false,
              },
            ],
          },
        };
      },
    },
  };

  adminPage.setActor({ id: "admin-local", roles: ["admin"] });
  await adminPage.wire();

  const reasonInput = elements.get("admin-policy-reason-input");
  reasonInput.value = "Tighten normalization guardrails";
  await fireEvent(reasonInput, "input", { target: reasonInput });

  const saveButton = elements.get("admin-qc-save-policy");
  await fireEvent(saveButton, "click", { target: saveButton });

  assert.equal(updateCalls.length, 1);
  const updateRequest = updateCalls[0];
  assert.equal(updateRequest.actorId, "admin-local");
  assert.equal(updateRequest.actorRole, "admin");
  assert.equal(updateRequest.reason, "Tighten normalization guardrails");
  assert.equal(String(updateRequest.requestId).startsWith("admin-policy-"), true);
  assert.equal(updateRequest.expectedPolicyVersion, 1);
  assert.equal(updateRequest.policy.policyId, "default-wave2-policy");
  assert.equal(updateRequest.policy.ruleSetVersion, "2026.02.wave2-baseline");
  assert.equal(updateRequest.policy.rules.length, 1);
  assert.equal(updateRequest.policy.rules[0].ruleId, "DEMO_NORMALIZATION_INVALID");
  assert.deepEqual(updateRequest.policy.rules[0].params, {
    target_peak_db: -1,
    tolerance_db: 0.7,
    strict_enforcement: false,
  });

  const feedback = elements.get("admin-qc-feedback");
  assert.equal(feedback.textContent, "Policy saved to version 2.");
  assert.equal(reasonInput.value, "");
  assert.equal(saveButton.disabled, false);

  delete global.document;
  delete global.fileeaters;
});

test("admin config rollback flow requires confirmation and reloads after success", async () => {
  const adminPagePath = path.join(__dirname, "..", "src", "renderer", "features", "admin", "admin-page.js");
  delete require.cache[adminPagePath];
  const adminPage = require(adminPagePath);

  const { document, elements } = buildAdminDomHarness();
  const rollbackCalls = [];
  const listCalls = [];
  const historyCalls = [];
  const promptValues = ["Undo unsafe publish", "ROLLBACK"];

  global.document = document;
  global.prompt = () => promptValues.shift() || "";
  global.fileeaters = {
    admin: {
      qcPolicy: {
        async get() {
          return {
            ok: true,
            data: {
              policy: {
                policyId: "default-wave2-policy",
                policyVersion: 1,
                ruleSetVersion: "2026.02.wave2-baseline",
                rules: [],
              },
            },
          };
        },
        async update() {
          return {
            ok: true,
            data: {
              policy: {
                policyId: "default-wave2-policy",
                policyVersion: 2,
                ruleSetVersion: "2026.02.wave2-baseline",
                rules: [],
              },
            },
          };
        },
      },
      configs: {
        async list() {
          listCalls.push(true);
          return {
            ok: true,
            data: {
              configs: [
                {
                  id: "cfg-1",
                  configType: "qc_policy",
                  version: 2,
                  payloadJson: {},
                  publishedBy: "admin-1",
                  publishedAt: "2026-03-10T12:00:00.000Z",
                  isDraft: false,
                  createdAt: "2026-03-10T11:00:00.000Z",
                },
              ],
            },
          };
        },
        async rollback(request) {
          rollbackCalls.push(request);
          return {
            ok: true,
            data: {
              config: {
                id: request.id,
                configType: "qc_policy",
                version: 3,
                payloadJson: {},
                publishedBy: request.actorId,
                publishedAt: "2026-03-10T12:10:00.000Z",
                isDraft: false,
                createdAt: "2026-03-10T11:00:00.000Z",
              },
            },
          };
        },
      },
      integrations: {
        async listHealth() {
          return { ok: true, data: { integrations: [] } };
        },
      },
      ops: {
        async listHistory() {
          historyCalls.push(true);
          return { ok: true, data: { entries: [] } };
        },
      },
    },
    qc: {
      async listRules() {
        return {
          ok: true,
          data: {
            rules: [],
          },
        };
      },
    },
  };

  adminPage.setActor({ id: "admin-local", roles: ["admin"] });
  try {
    await adminPage.wire();

    const configsBody = elements.get("admin-configs-body");
    assert.equal(configsBody.innerHTML.includes('data-config-rollback="cfg-1"'), true);

    await fireEvent(configsBody, "click", {
      target: {
        dataset: {
          configRollback: "cfg-1",
        },
      },
    });

    assert.equal(rollbackCalls.length, 1);
    assert.equal(rollbackCalls[0].id, "cfg-1");
    assert.equal(rollbackCalls[0].reason, "Undo unsafe publish");
    assert.equal(rollbackCalls[0].confirmation, "ROLLBACK");
    assert.equal(listCalls.length >= 2, true);
    assert.equal(historyCalls.length >= 2, true);
    assert.equal(elements.get("admin-config-feedback").textContent, "Rolled back cfg-1 to v3.");
  } finally {
    delete global.document;
    delete global.fileeaters;
    delete global.prompt;
  }
});
