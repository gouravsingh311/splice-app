import { expect, test } from "@playwright/test";
import path from "node:path";
import { buildActorHeaders, DEFAULT_E2E_INTERNAL_API_TOKEN, resolveEnvOrDefault } from "../../test-utils/authContext";
import { getSeededAccount, installRendererApiShim, launchDesktop, loginViaUi } from "../support";

test.describe("Durability scenarios", () => {
  test("[NR-028] notification read state survives app relaunch", async ({ request }) => {
    const { email, password } = getSeededAccount("creator");
    const submissionId = `sub-durability-${Date.now()}`;
    let notificationId = "";
    const notificationsUrl = (apiUrl: string) =>
      `${apiUrl}/notifications?actor_id=${encodeURIComponent(email)}&actor_role=creator`;

    const firstRun = await launchDesktop({
      actorId: email,
      actorRoles: "creator",
      seedNotifications: false,
    });
    try {
      await installRendererApiShim(firstRun.page, undefined, firstRun.apiUrl);
      await loginViaUi(firstRun.page, { email, password });
      const creatorHeaders = buildActorHeaders({ actorId: email, actorRoles: "creator" });
      const systemHeaders = buildActorHeaders({
        actorId: "system-durability",
        actorRoles: "system",
        internalToken: resolveEnvOrDefault(process.env.SPLICE_INTERNAL_API_TOKEN, DEFAULT_E2E_INTERNAL_API_TOKEN),
      });
      const draftResponse = await request.post(`${firstRun.apiUrl}/submissions/draft`, {
        headers: creatorHeaders,
        data: {
          submission_id: submissionId,
          creator_id: email,
          preferred_release_month: "2026-11",
          metadata: { pack_name: "durability-notifications-pack" },
        },
      });
      expect(draftResponse.ok()).toBeTruthy();

      const emitResponse = await request.post(`${firstRun.apiUrl}/internal/notifications/emit`, {
        headers: systemHeaders,
        data: {
          type: "approved",
          severity: "info",
          channel: "in_app",
          title: `Approved ${submissionId}`,
          message: "Persist notification read state across relaunch.",
          submission_id: submissionId,
        },
      });
      expect(emitResponse.ok()).toBeTruthy();
      const emitPayload = await emitResponse.json();
      notificationId = String(emitPayload.notification?.notification_id || emitPayload.notification?.id || "");
      expect(notificationId).toBeTruthy();

      const listBeforeMarkRead = await request.get(notificationsUrl(firstRun.apiUrl), {
        headers: creatorHeaders,
      });
      expect(listBeforeMarkRead.ok()).toBeTruthy();
      const listBeforePayload = await listBeforeMarkRead.json();
      const createdNotification = Array.isArray(listBeforePayload.notifications)
        ? listBeforePayload.notifications.find((item: Record<string, unknown>) => String(item.notification_id ?? item.id) === String(notificationId))
        : null;
      expect(createdNotification).toBeTruthy();

      const markReadResponse = await request.post(`${firstRun.apiUrl}/notifications/mark-read`, {
        headers: creatorHeaders,
        data: {
          actor_id: email,
          actor_role: "creator",
          notification_ids: [notificationId],
        },
      });
      expect(markReadResponse.ok()).toBeTruthy();

      const listAfterMarkRead = await request.get(notificationsUrl(firstRun.apiUrl), {
        headers: creatorHeaders,
      });
      expect(listAfterMarkRead.ok()).toBeTruthy();
      const listAfterPayload = await listAfterMarkRead.json();
      const markedNotification = Array.isArray(listAfterPayload.notifications)
        ? listAfterPayload.notifications.find((item: Record<string, unknown>) => String(item.notification_id ?? item.id) === String(notificationId))
        : null;
      expect(markedNotification).toBeTruthy();
      expect(Boolean(markedNotification.read)).toBeTruthy();
    } finally {
      await firstRun.app.close();
    }

    const secondRun = await launchDesktop({
      actorId: email,
      actorRoles: "creator",
      seedNotifications: false,
    });
    try {
      await installRendererApiShim(secondRun.page, undefined, secondRun.apiUrl);
      await loginViaUi(secondRun.page, { email, password });

      const notificationsResponse = await request.get(notificationsUrl(secondRun.apiUrl), {
        headers: buildActorHeaders({ actorId: email, actorRoles: "creator" }),
      });
      expect(notificationsResponse.ok()).toBeTruthy();
      const notificationsPayload = await notificationsResponse.json();
      const persistedNotification = Array.isArray(notificationsPayload.notifications)
        ? notificationsPayload.notifications.find((item: Record<string, unknown>) => String(item.notification_id ?? item.id) === String(notificationId))
        : null;
      expect(persistedNotification).toBeTruthy();
      expect(Boolean(persistedNotification.read)).toBeTruthy();
    } finally {
      await secondRun.app.close();
    }
  });

  test("[NR-020] qc result history remains available after relaunch", async ({ request }) => {
    const { email, password } = getSeededAccount("creator");
    const submissionId = `sub-durability-qc-${Date.now()}`;
    const localPackPath = process.env.E2E_PACK_PATH ?? path.join(process.cwd(), "e2e/fixtures/valid_pack");

    const firstRun = await launchDesktop({ actorId: email, actorRoles: "creator" });
    try {
      await installRendererApiShim(firstRun.page, undefined, firstRun.apiUrl);
      await loginViaUi(firstRun.page, { email, password });
      const creatorHeaders = buildActorHeaders({ actorId: email, actorRoles: "creator" });

      const draftResponse = await request.post(`${firstRun.apiUrl}/submissions/draft`, {
        headers: creatorHeaders,
        data: {
          submission_id: submissionId,
          creator_id: email,
          preferred_release_month: "2026-11",
          metadata: { pack_name: "durability-pack" },
        },
      });
      expect(draftResponse.ok()).toBeTruthy();

      const evaluateResponse = await request.post(`${firstRun.apiUrl}/qc/evaluate`, {
        headers: creatorHeaders,
        data: {
          request_id: `req-durability-${Date.now()}`,
          submission_id: submissionId,
          actor_id: email,
          actor_role: "creator",
          pack: {
            pack_name: "valid_pack",
            local_pack_path: localPackPath,
            declared_top_level_folders: ["Audio", "Artwork", "Demo", "Description"],
            audio_zip: { filename: "valid_pack.zip", size_bytes: 1024 },
            sample_count: 2,
            contains_unsupported_name_tokens: false,
          },
        },
      });
      expect(evaluateResponse.ok()).toBeTruthy();
      const evaluatePayload = await evaluateResponse.json();
      expect(evaluatePayload.report).toBeTruthy();

      const firstResultsResponse = await request.get(`${firstRun.apiUrl}/qc/results/${submissionId}`, {
        headers: creatorHeaders,
      });
      expect(firstResultsResponse.ok()).toBeTruthy();
      const firstResultsPayload = await firstResultsResponse.json();
      expect(Array.isArray(firstResultsPayload.history)).toBeTruthy();
    } finally {
      await firstRun.app.close();
    }

    const secondRun = await launchDesktop({ actorId: email, actorRoles: "creator" });
    try {
      await installRendererApiShim(secondRun.page, undefined, secondRun.apiUrl);
      await loginViaUi(secondRun.page, { email, password });

      const resultsResponse = await request.get(`${secondRun.apiUrl}/qc/results/${submissionId}`, {
        headers: buildActorHeaders({ actorId: email, actorRoles: "creator" }),
      });
      expect(resultsResponse.ok()).toBeTruthy();
      const resultsPayload = await resultsResponse.json();
      expect(Array.isArray(resultsPayload.history)).toBeTruthy();
      expect(resultsPayload.latest).toBeTruthy();
    } finally {
      await secondRun.app.close();
    }
  });
});
