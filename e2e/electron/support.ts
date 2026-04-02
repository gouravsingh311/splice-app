import { _electron as electron, expect, type APIRequestContext, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildActorHeaders,
  DEFAULT_E2E_AUTH_ACCESS_SECRET,
  DEFAULT_E2E_INTERNAL_API_TOKEN,
  resolveEnvOrDefault,
  resolvePrimaryActorRole,
} from "../test-utils/authContext";

export const API_BASE_URL = process.env.PW_API_BASE_URL ?? "http://127.0.0.1:8017";
const E2E_PACK_PATH = process.env.E2E_PACK_PATH ?? path.join(process.cwd(), "e2e/fixtures/valid_pack");

export const SEEDED_E2E_ACCOUNTS = {
  creator: { email: "creator@splice.local", password: "CreatorPass123!" },
  reviewer: { email: "reviewer@splice.local", password: "ReviewerPass123!" },
  admin: { email: "admin@splice.local", password: "AdminPass123!" },
} as const;

export type SeededE2ERole = keyof typeof SEEDED_E2E_ACCOUNTS;

export function getSeededAccount(role: SeededE2ERole): {
  email: string;
  password: string;
} {
  return SEEDED_E2E_ACCOUNTS[role];
}

export type LaunchResult = {
  app: ElectronApplication;
  page: Page;
  apiUrl: string;
  actorId: string;
  actorRole: string;
  internalToken: string;
};

async function resolveAppApiUrl(app: ElectronApplication): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const url = await app.evaluate(() => (process as any).env.SPLICE_API_BASE_URL || '').catch(() => '');
    if (url && url.startsWith('http')) return url;
    await new Promise((r) => setTimeout(r, 500));
  }
  return API_BASE_URL;
}

async function waitForBackendReady(baseUrl: string, timeout = 180_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`${baseUrl}/health/live`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Backend at ${baseUrl} did not become ready within ${timeout}ms`);
}

export async function launchDesktop(options?: {
  actorId?: string;
  actorRoles?: string;
  seedNotifications?: boolean;
}): Promise<LaunchResult> {
  const actorId = options?.actorId ?? "e2e-actor";
  const actorRoles = options?.actorRoles ?? "creator";
  const actorRole = resolvePrimaryActorRole(actorRoles);
  const internalToken = resolveEnvOrDefault(process.env.SPLICE_INTERNAL_API_TOKEN, DEFAULT_E2E_INTERNAL_API_TOKEN);
  const authAccessSecret = resolveEnvOrDefault(process.env.SPLICE_AUTH_ACCESS_SECRET, DEFAULT_E2E_AUTH_ACCESS_SECRET);
  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      SPLICE_ACTOR_ID: actorId,
      SPLICE_AUTH_ROLES: actorRoles,
      SPLICE_AUTH_ACCESS_SECRET: authAccessSecret,
      SPLICE_INTERNAL_API_TOKEN: internalToken,
      SPLICE_SEED_NOTIFICATIONS: options?.seedNotifications === false ? "false" : "true",
      SPLICE_ENV: "local",
      SPLICE_ENABLE_HEALTH_SERVER: "false",
      PLAYWRIGHT_E2E: "1",
      E2E_PACK_PATH: E2E_PACK_PATH,
    },
  });

  const apiUrl = await resolveAppApiUrl(app);
  await waitForBackendReady(apiUrl);

  const page = await app.firstWindow();
  await page.addInitScript(
    ({ actorId: contextActorId, actorRole: contextActorRole, internalToken: contextInternalToken }) => {
      (globalThis as any).__pwE2EActorContext = {
        actorId: contextActorId,
        actorRole: contextActorRole,
        internalToken: contextInternalToken,
      };
    },
    { actorId, actorRole, internalToken },
  );
  await expect(page.getByRole("heading", { level: 1, name: "Auth & Access" })).toBeVisible();
  return { app, page, apiUrl, actorId, actorRole, internalToken };
}

export async function installRendererApiShim(page: Page, exportPath?: string, shimBaseUrl?: string): Promise<void> {
  await page.addInitScript(
    ({ baseUrl, forcedExportPath }) => {
      (globalThis as any).global = globalThis;
      const normalizeBaseUrl = (raw: string): string => raw.replace(/\/$/, "");
      const apiBase = normalizeBaseUrl(baseUrl);

      const toOk = (data: unknown) => ({ ok: true, data });
      const toErr = (code: string, message: string) => ({
        ok: false,
        error: { code, reason: code, message, status: 500 },
      });

      const fetchJson = async (url: string, init?: RequestInit) => {
        const actorContext = (globalThis as any).__pwE2EActorContext ?? {};
        const headers = new Headers(init?.headers ?? {});
        headers.set("content-type", "application/json");
        headers.set("accept", "application/json");
        if (actorContext.actorId) {
          headers.set("X-Actor-Id", String(actorContext.actorId));
        }
        if (actorContext.actorRole) {
          headers.set("X-Actor-Role", String(actorContext.actorRole));
        }
        if (actorContext.internalToken) {
          headers.set("X-Internal-Token", String(actorContext.internalToken));
        }
        const response = await fetch(url, {
          ...(init ?? {}),
          headers,
        });
        const body = await response.json().catch(() => null);
        return { response, body };
      };

      const mapSubmission = (submission: any) => ({
        submissionId: submission.submission_id,
        creatorId: submission.creator_id,
        currentState: submission.current_state,
        version: submission.version,
        packName: submission.pack_name,
        labelName: submission.label_name,
        releaseMonth: submission.release_month,
        notes: submission.notes,
        tags: submission.tags ?? [],
        airtableFormCompleted: Boolean(submission.airtable_form_completed),
        airtablePayloadChecksum: submission.airtable_payload_checksum ?? null,
        airtableSyncStatus: submission.airtable_sync_status ?? null,
        airtableRecordId: submission.airtable_record_id ?? null,
        airtableRecordUrl: submission.airtable_record_url ?? null,
        airtableLastSyncedAt: submission.airtable_last_synced_at ?? null,
        airtableLastErrorCode: submission.airtable_last_error_code ?? null,
        airtableLastErrorDetail: submission.airtable_last_error_detail ?? null,
        updatedAt: submission.updated_at,
      });

      const install = () => {
        if (!(window as any).splice) {
          return;
        }
        if ((window as any).__pwE2EShimInstalled) {
          return;
        }

        const baseApi = (window as any).splice;
        const qcRuns: Record<string, any[]> = {};

        const shim = {
          ...baseApi,
          qc: {
            ...baseApi.qc,
            evaluatePack: async (payload: any) => {
              const result = await baseApi.qc.evaluatePack(payload);
              if (result?.ok) {
                const report = result.data?.report ?? {};
                const findings = Array.isArray(report.findings) ? report.findings : [];
                const runRecord = {
                  runId: payload.requestId,
                  status: report.status ?? "failed",
                  startedAt: new Date().toISOString(),
                  completedAt: report.generatedAt ?? new Date().toISOString(),
                  findings: findings.map((finding: any) => ({
                    findingId: finding.findingId ?? `${finding.ruleId ?? "rule"}:${finding.message ?? "issue"}`,
                    ruleId: finding.ruleId,
                    severity: finding.blocking || finding.severity === "blocking" ? "blocking" : "warning",
                    category: "samples",
                    fileRef: finding.context?.file_ref ?? null,
                    message: finding.message,
                    remediation: finding.remediation,
                    diffTag: "new",
                  })),
                };
                const existingRuns = Array.isArray(qcRuns[payload.submissionId])
                  ? qcRuns[payload.submissionId]
                  : [];
                qcRuns[payload.submissionId] = existingRuns.concat(runRecord);
              }
              return result;
            },
            getResults: async (payload: any) => {
              const history = Array.isArray(qcRuns[payload.submissionId])
                ? qcRuns[payload.submissionId]
                : [];
              if (history.length === 0) {
                return toOk({
                  runId: null,
                  findings: [],
                  status: "not_run",
                  startedAt: null,
                  completedAt: null,
                  history: [],
                });
              }
              const latest = history[history.length - 1];
              return toOk({
                ...latest,
                history,
              });
            },
            exportReport: async (payload: any) => {
              (window as any).__pwSaveDialogOpened = true;
              (window as any).__pwLastExportPayload = payload;
              const outPath =
                forcedExportPath ||
                `${apiBase.replace(/[^a-z0-9]/gi, "_")}_qc_export_${Date.now()}.json`;
              return toOk({ canceled: false, path: outPath });
            },
          },
          creator: {
            profile: {
              get: async (payload: any) => {
                const actorId = payload.actorId || payload.userId || "desktop-local";
                const { response, body } = await fetchJson(
                  `${apiBase}/creator/profile?user_id=${encodeURIComponent(payload.userId || "me")}&actor_id=${encodeURIComponent(actorId)}`,
                );
                if (!response.ok) {
                  return toErr("CREATOR_PROFILE_GET_FAILED", body?.detail || "Failed to load profile");
                }
                return toOk(body);
              },
            },
          },
          submissions: {
            createDraft: async (payload: any) => {
              const { response, body } = await fetchJson(`${apiBase}/creator/submissions/draft`, {
                method: "POST",
                body: JSON.stringify({
                  submission_id: payload.submissionId,
                  creator_id: payload.creatorId,
                  pack_name: payload.packName,
                  label_name: payload.labelName,
                  release_month: payload.releaseMonth,
                  notes: payload.notes,
                  tags: payload.tags ?? [],
                  airtable_form_completed: payload.airtableFormCompleted,
                  airtable_payload_checksum: payload.airtablePayloadChecksum,
                  autosave_json: payload.autosaveJson,
                }),
              });
              if (!response.ok) {
                return toErr("SUBMISSION_DRAFT_FAILED", body?.detail || "Failed to create draft");
              }
              return toOk({ submission: mapSubmission(body.submission) });
            },
            updateMetadata: async (payload: any) => {
              const { response, body } = await fetchJson(
                `${apiBase}/creator/submissions/${encodeURIComponent(payload.submissionId)}/metadata`,
                {
                  method: "PUT",
                  body: JSON.stringify({
                    creator_id: payload.creatorId,
                    pack_name: payload.packName,
                    label_name: payload.labelName,
                    release_month: payload.releaseMonth,
                    notes: payload.notes,
                    tags: payload.tags ?? [],
                    airtable_form_completed: payload.airtableFormCompleted,
                    airtable_payload_checksum: payload.airtablePayloadChecksum,
                    autosave_json: payload.autosaveJson,
                  }),
                },
              );
              if (!response.ok) {
                return toErr("SUBMISSION_METADATA_FAILED", body?.detail || "Failed to update metadata");
              }
              return toOk({ submission: mapSubmission(body.submission) });
            },
            syncAirtable: async (payload: any) => {
              const { response, body } = await fetchJson(
                `${apiBase}/creator/submissions/${encodeURIComponent(payload.submissionId)}/airtable/sync`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    creator_id: payload.creatorId,
                    force_relink: Boolean(payload.forceRelink),
                  }),
                },
              );
              if (!response.ok) {
                return toErr("SUBMISSION_AIRTABLE_SYNC_FAILED", body?.detail || "Failed to sync Airtable");
              }
              return toOk({
                submissionId: body.submission_id,
                syncStatus: body.sync_status,
                airtableFormCompleted: Boolean(body.airtable_form_completed),
                airtablePayloadChecksum: body.airtable_payload_checksum ?? null,
                airtableRecordId: body.airtable_record_id ?? null,
                airtableRecordUrl: body.airtable_record_url ?? null,
                lastSyncedAt: body.last_synced_at ?? null,
                lastErrorCode: body.last_error_code ?? null,
                lastErrorDetail: body.last_error_detail ?? null,
                canonicalRecordId: body.canonical_record_id ?? null,
                mappedPayload: body.mapped_payload
                  ? {
                      labelName: body.mapped_payload.label_name ?? null,
                      packName: body.mapped_payload.pack_name ?? null,
                      releaseMonth: body.mapped_payload.release_month ?? null,
                      notes: body.mapped_payload.notes ?? null,
                      tags: body.mapped_payload.tags ?? [],
                    }
                  : null,
              });
            },
            resetAirtable: async (payload: any) => {
              const { response, body } = await fetchJson(
                `${apiBase}/creator/submissions/${encodeURIComponent(payload.submissionId)}/airtable/reset`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    creator_id: payload.creatorId,
                  }),
                },
              );
              if (!response.ok) {
                return toErr("SUBMISSION_AIRTABLE_RESET_FAILED", body?.detail || "Failed to reset Airtable");
              }
              return toOk({
                submissionId: body.submission_id,
                syncStatus: body.sync_status,
                airtableFormCompleted: Boolean(body.airtable_form_completed),
                airtablePayloadChecksum: body.airtable_payload_checksum ?? null,
                airtableRecordId: body.airtable_record_id ?? null,
                airtableRecordUrl: body.airtable_record_url ?? null,
                lastSyncedAt: body.last_synced_at ?? null,
                lastErrorCode: body.last_error_code ?? null,
                lastErrorDetail: body.last_error_detail ?? null,
                canonicalRecordId: body.canonical_record_id ?? null,
                mappedPayload: body.mapped_payload
                  ? {
                      labelName: body.mapped_payload.label_name ?? null,
                      packName: body.mapped_payload.pack_name ?? null,
                      releaseMonth: body.mapped_payload.release_month ?? null,
                      notes: body.mapped_payload.notes ?? null,
                      tags: body.mapped_payload.tags ?? [],
                    }
                  : null,
              });
            },
            list: async (payload: any) => {
              const creatorId = payload.creatorId || "me";
              const { response, body } = await fetchJson(
                `${apiBase}/creator/submissions?creator_id=${encodeURIComponent(creatorId)}&actor_id=${encodeURIComponent(creatorId)}`,
              );
              if (!response.ok || !Array.isArray(body)) {
                return toErr("SUBMISSION_LIST_FAILED", "Failed to list submissions");
              }
              const apiSubmissions = body.map(mapSubmission);
              const existingIds = new Set(apiSubmissions.map((item: any) => item.submissionId));
              const syntheticSubmissions = Object.keys(qcRuns)
                .filter((submissionId) => !existingIds.has(submissionId))
                .map((submissionId) => {
                  const runs = qcRuns[submissionId] || [];
                  const latestRun = runs[runs.length - 1];
                  return {
                    submissionId,
                    creatorId,
                    currentState: "draft",
                    version: 1,
                    packName: null,
                    releaseMonth: null,
                    notes: null,
                    tags: [],
                    updatedAt: latestRun?.completedAt || latestRun?.startedAt || new Date().toISOString(),
                  };
                });
              return toOk({ submissions: apiSubmissions.concat(syntheticSubmissions) });
            },
            timeline: async (payload: any) => {
              const creatorId = payload.creatorId || "me";
              const { response, body } = await fetchJson(
                `${apiBase}/creator/submissions/${encodeURIComponent(payload.submissionId)}/timeline?creator_id=${encodeURIComponent(creatorId)}&actor_id=${encodeURIComponent(creatorId)}`,
              );
              if (!response.ok || !Array.isArray(body)) {
                return toErr("SUBMISSION_TIMELINE_FAILED", "Failed to load timeline");
              }
              return toOk({
                timeline: body.map((record: any) => ({
                  transitionId: record.transition_id,
                  fromState: record.from_state,
                  toState: record.to_state,
                  actorId: record.actor_id,
                  actorRole: record.actor_role,
                  reason: record.reason,
                  requestId: record.request_id,
                  createdAt: record.created_at,
                })),
              });
            },
          },
          notifications: {
            list: async (payload: any) => {
              const actorContext = (globalThis as any).__pwE2EActorContext ?? {};
              const actorId = String(payload?.actorId ?? actorContext.actorId ?? "desktop-local");
              const actorRole = String(payload?.actorRole ?? actorContext.actorRole ?? "creator").toLowerCase();
              const params = new URLSearchParams({
                actor_id: actorId,
                actor_role: actorRole,
                include_read: String(payload.includeRead ?? true),
              });
              const { response, body } = await fetchJson(`${apiBase}/notifications?${params}`);
              if (!response.ok) {
                return toErr("NOTIFICATIONS_LIST_FAILED", body?.detail || "Failed to load notifications");
              }
              return toOk({ notifications: body.notifications ?? body ?? [] });
            },
            markRead: async (payload: any) => {
              const actorContext = (globalThis as any).__pwE2EActorContext ?? {};
              const notificationIds = Array.isArray(payload?.notificationIds)
                ? payload.notificationIds.filter((value: unknown) => typeof value === "string" && value.length > 0)
                : [payload?.notificationId].filter((value: unknown) => typeof value === "string" && value.length > 0);
              const { response, body } = await fetchJson(`${apiBase}/notifications/mark-read`, {
                method: "POST",
                body: JSON.stringify({
                  notification_ids: notificationIds,
                  actor_id: String(payload?.actorId ?? actorContext.actorId ?? "desktop-local"),
                  actor_role: String(payload?.actorRole ?? actorContext.actorRole ?? "creator").toLowerCase(),
                }),
              });
              if (!response.ok) {
                return toErr("NOTIFICATIONS_MARK_READ_FAILED", body?.detail || "Failed to mark read");
              }
              return toOk(body);
            },
            markAllRead: async (payload: any) => {
              const actorContext = (globalThis as any).__pwE2EActorContext ?? {};
              const { response, body } = await fetchJson(`${apiBase}/notifications/mark-all-read`, {
                method: "POST",
                body: JSON.stringify({
                  actor_id: String(payload?.actorId ?? actorContext.actorId ?? "desktop-local"),
                  actor_role: String(payload?.actorRole ?? actorContext.actorRole ?? "creator").toLowerCase(),
                }),
              });
              if (!response.ok) {
                return toErr("NOTIFICATIONS_MARK_ALL_READ_FAILED", body?.detail || "Failed to mark all read");
              }
              return toOk(body);
            },
            retry: async (payload: any) => {
              const actorContext = (globalThis as any).__pwE2EActorContext ?? {};
              const { response, body } = await fetchJson(`${apiBase}/notifications/retry`, {
                method: "POST",
                body: JSON.stringify({
                  notification_id: payload.notificationId,
                  actor_id: String(payload?.actorId ?? actorContext.actorId ?? "desktop-local"),
                  actor_role: String(payload?.actorRole ?? actorContext.actorRole ?? "creator").toLowerCase(),
                }),
              });
              if (!response.ok) {
                return toErr("NOTIFICATIONS_RETRY_FAILED", body?.detail || "Failed to retry notification");
              }
              return toOk(body);
            },
          },
        };

        (window as any).electronAPI = shim;
        (window as any).__pwE2EShimInstalled = true;
      };

      install();
      window.addEventListener("DOMContentLoaded", install);
      document.addEventListener("readystatechange", install);
    },
    { baseUrl: shimBaseUrl ?? API_BASE_URL, forcedExportPath: exportPath ?? null },
  );

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Auth & Access" })).toBeVisible();
}

export async function createAccountViaApi(
  _request: APIRequestContext,
  options: { email: string; password: string; role?: "creator" | "reviewer" | "admin"; baseUrl?: string },
): Promise<void> {
  throw new Error(
    `createAccountViaApi is disabled in strict mode. Use pre-seeded accounts instead (requested=${options.email}, base=${options.baseUrl ?? API_BASE_URL}).`,
  );
}

async function assertAuthenticatedShell(page: Page, expectedRole?: SeededE2ERole): Promise<void> {
  const shellTimeout = 20_000;

  await expect(page.locator("#profile-menu-trigger")).toBeVisible({ timeout: shellTimeout });
  await expect(page.locator("#sidebar-primary-nav")).toBeVisible({ timeout: shellTimeout });
  await expect(page.locator('#sidebar-primary-nav [data-nav="dashboard"]')).toBeVisible({ timeout: shellTimeout });
  await expect(page.locator("#sidebar-role-badge")).toBeVisible({ timeout: shellTimeout });
  if (expectedRole) {
    await expect(page.locator("#sidebar-role-badge")).toHaveText(expectedRole.toUpperCase(), {
      timeout: shellTimeout,
    });
  }
}

async function performUiLogin(
  page: Page,
  options: { email: string; password: string; expectedRole?: SeededE2ERole },
): Promise<void> {
  await expect(page.locator("#login-form")).toBeVisible();
  await page.locator("#login-email").fill(options.email);
  await page.locator("#login-password").fill(options.password);
  await page.locator("#login-form button[type='submit']").click();
  await assertAuthenticatedShell(page, options.expectedRole);
}

export async function loginAsSeededIdentity(page: Page, role: SeededE2ERole): Promise<void> {
  const { email, password } = getSeededAccount(role);
  await performUiLogin(page, { email, password, expectedRole: role });
}

export async function loginViaUi(
  page: Page,
  options: { email: string; password: string; expectedRole?: SeededE2ERole },
): Promise<void> {
  await performUiLogin(page, options);
}

export async function logoutCurrentUser(page: Page): Promise<void> {
  await page.locator("#profile-menu-trigger").click();
  await expect(page.locator("#profile-menu")).toBeVisible();
  await page.locator("#logout-button").click();
  await expect(page.locator("#login-form")).toBeVisible({ timeout: 20_000 });
}

export async function switchRoleInSameSession(page: Page, role: SeededE2ERole): Promise<void> {
  await logoutCurrentUser(page);
  await loginAsSeededIdentity(page, role);
}

export async function navigate(page: Page, navId: string): Promise<void> {
  await page.locator(`#sidebar-primary-nav [data-nav="${navId}"]`).click();
  await expect(page.locator(`#view-${navId}`)).toBeVisible();
}

export async function navigateViaNavHit(
  page: Page,
  requestedNavId: string,
  expectedViewId: string = requestedNavId,
): Promise<void> {
  const clickedInSidebar = await page.evaluate((navId) => {
    const candidates = Array.from(
      document.querySelectorAll(`#sidebar-primary-nav [data-nav="${navId}"]`),
    ) as HTMLElement[];
    if (candidates.length === 0) {
      return false;
    }
    const preferred =
      candidates.find((candidate) => {
        const style = window.getComputedStyle(candidate);
        const visible = style.display !== "none" && style.visibility !== "hidden";
        const enabled = !candidate.hasAttribute("disabled") && candidate.getAttribute("aria-disabled") !== "true";
        return visible && enabled;
      }) ?? candidates[0];
    preferred.click();
    return true;
  }, requestedNavId);

  if (!clickedInSidebar) {
    await page.evaluate((navId) => {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.setAttribute("data-nav", navId);
      trigger.style.display = "none";
      document.body.appendChild(trigger);
      trigger.click();
      trigger.remove();
    }, requestedNavId);
  }

  await expect(page.locator(`#view-${expectedViewId}`)).toBeVisible();
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10_000)}@example.com`;
}

export async function createDraftAndTransition(
  request: APIRequestContext,
  options: {
    submissionId: string;
    creatorId: string;
    toState: "under_review" | "approved";
    actorId: string;
    actorRole: "creator" | "reviewer" | "admin";
    expectedVersion: number;
    baseUrl?: string;
  },
): Promise<void> {
  const base = options.baseUrl ?? API_BASE_URL;
  const headers = buildActorHeaders({
    actorId: options.actorId,
    actorRoles: options.actorRole,
  });
  const draftResponse = await request.post(`${base}/submissions/draft`, {
    headers,
    data: { submission_id: options.submissionId, creator_id: options.creatorId, preferred_release_month: "2026-06", metadata: { pack_name: `Pack ${options.submissionId}` } },
  });
  expect(draftResponse.ok()).toBeTruthy();

  const transitionResponse = await request.post(
    `${base}/submissions/${encodeURIComponent(options.submissionId)}/transition`,
    {
      headers,
      data: { request_id: `${options.submissionId}-${options.toState}`, to_state: options.toState, actor_id: options.actorId, actor_role: options.actorRole, expected_version: options.expectedVersion },
    },
  );
  expect(transitionResponse.ok()).toBeTruthy();
}

export async function ensureFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
