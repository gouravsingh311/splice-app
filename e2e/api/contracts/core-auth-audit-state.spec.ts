import { expect, test } from "@playwright/test";
import { buildActorHeaders } from "../../test-utils/authContext";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe("Core auth/audit/state API contract scenarios", () => {
  test("[AUTH-005] health and version endpoints are available", async ({ request }) => {
    const liveResponse = await request.get("/health/live");
    expect(liveResponse.status()).toBe(200);
    expect(await liveResponse.json()).toMatchObject({
      service: "splice-api",
      status: "live",
      environment: "local",
    });

    const readyResponse = await request.get("/health/ready");
    expect(readyResponse.status()).toBe(200);
    expect(await readyResponse.json()).toMatchObject({
      service: "splice-api",
      status: "ready",
      environment: "local",
    });

    const versionResponse = await request.get("/version");
    expect(versionResponse.status()).toBe(200);
    expect(await versionResponse.json()).toMatchObject({
      service: "splice-api",
      version: "0.1.0",
      environment: "local",
    });
  });

  test("[AUTH-010] auth contracts are exposed and OTP verification failure is deterministic", async ({ request }) => {
    const openApiResponse = await request.get("/openapi.json");
    expect(openApiResponse.status()).toBe(200);
    const openApiPayload = await openApiResponse.json();
    const expectedAuthRoutes = [
      "/auth/register",
      "/auth/otp/send",
      "/auth/otp/verify",
      "/auth/login",
      "/auth/refresh",
      "/auth/logout",
      "/auth/logout-all",
      "/auth/forgot-password",
      "/auth/reset-password",
      "/auth/me",
    ];

    for (const route of expectedAuthRoutes) {
      expect(openApiPayload.paths[route]).toBeDefined();
    }

    const unknownForgotResponse = await request.post("/auth/forgot-password", {
      data: {
        email: `${uniqueId("missing")}@example.com`,
      },
    });
    expect(unknownForgotResponse.status()).toBe(200);
    expect(await unknownForgotResponse.json()).toEqual({
      challenge_id: null,
      expires_at: null,
      cooldown_seconds: 0,
    });

    const otpTarget = `${uniqueId("otp")}@example.com`;
    const otpSendResponse = await request.post("/auth/otp/send", {
      data: {
        target: otpTarget,
        purpose: "register",
      },
    });
    expect(otpSendResponse.status()).toBe(200);

    const otpSendPayload = await otpSendResponse.json();
    const otpVerifyResponse = await request.post("/auth/otp/verify", {
      data: {
        challenge_id: otpSendPayload.challenge_id,
        purpose: "register",
        otp_code: "0000",
      },
    });
    expect(otpVerifyResponse.status()).toBe(401);
    const otpVerifyPayload = await otpVerifyResponse.json();
    expect(otpVerifyPayload.error.code).toBe("AUTH_UNAUTHORIZED");
  });

  test("[XR-018] audit append/list/get/export flow works end-to-end", async ({ request }) => {
    const actorId = uniqueId("audit-actor");
    const appendResponse = await request.post("/internal/audit/append", {
      data: {
        schema_version: 1,
        actor_id: actorId,
        action: "desktop.ipc.denied.v1",
        entity_type: "desktop",
        entity_id: "fileeaters.audit.security-events.list.v1",
        metadata: {
          channel: "fileeaters.audit.security-events.list.v1",
          reason: "PERMISSION_FORBIDDEN",
        },
      },
    });
    expect(appendResponse.status()).toBe(200);
    const appendPayload = await appendResponse.json();
    expect(appendPayload.id).toBeTruthy();
    expect(appendPayload.event_hash).toBeTruthy();

    const getResponse = await request.get(`/audit/events/${appendPayload.id}`);
    expect(getResponse.status()).toBe(200);
    const getPayload = await getResponse.json();
    expect(getPayload.id).toBe(appendPayload.id);
    expect(getPayload.event_hash).toBe(appendPayload.event_hash);

    const listResponse = await request.get("/audit/events", {
      params: {
        actor_id: actorId,
        action: "desktop.ipc.denied.v1",
        limit: 10,
      },
    });
    expect(listResponse.status()).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.total).toBeGreaterThanOrEqual(1);
    expect(listPayload.events[0].actor_id).toBe(actorId);

    const jsonExportResponse = await request.get("/audit/export", {
      params: { format: "json" },
    });
    expect(jsonExportResponse.status()).toBe(200);
    const jsonExportPayload = await jsonExportResponse.json();
    expect(jsonExportPayload.format).toBe("json");
    expect(jsonExportPayload.content).toContain("\"events\"");

    const csvExportResponse = await request.get("/audit/export", {
      params: { format: "csv" },
    });
    expect(csvExportResponse.status()).toBe(200);
    const csvExportPayload = await csvExportResponse.json();
    expect(csvExportPayload.format).toBe("csv");
    expect(csvExportPayload.content).toContain("event_hash");
  });

  test("[XR-010] submission transition flow emits scheduling event contract", async ({ request }) => {
    const submissionId = uniqueId("sub");
    const creatorHeaders = buildActorHeaders({ actorId: "creator-e2e", actorRoles: "creator" });
    const reviewerHeaders = buildActorHeaders({ actorId: "reviewer-e2e", actorRoles: "reviewer" });

    const draftResponse = await request.post("/submissions/draft", {
      headers: creatorHeaders,
      data: {
        submission_id: submissionId,
        creator_id: "creator-e2e",
        preferred_release_month: "2026-10",
        metadata: {
          genre: "house",
        },
      },
    });
    expect(draftResponse.status()).toBe(200);
    expect((await draftResponse.json()).submission.current_state).toBe("draft");

    const underReviewResponse = await request.post(`/submissions/${submissionId}/transition`, {
      headers: creatorHeaders,
      data: {
        request_id: uniqueId("req"),
        to_state: "under_review",
        actor_id: "creator-e2e",
        actor_role: "creator",
        expected_version: 0,
      },
    });
    expect(underReviewResponse.status()).toBe(200);
    expect((await underReviewResponse.json()).orchestration.integration_events).toEqual([]);

    const approvedResponse = await request.post(`/submissions/${submissionId}/transition`, {
      headers: reviewerHeaders,
      data: {
        request_id: uniqueId("req"),
        to_state: "approved",
        actor_id: "reviewer-e2e",
        actor_role: "reviewer",
        expected_version: 1,
      },
    });
    expect(approvedResponse.status()).toBe(200);
    const approvedPayload = await approvedResponse.json();
    const schedulingEvent = approvedPayload.orchestration.integration_events.find(
      (event: { event_name: string }) => event.event_name === "submission.approved.scheduling.v1"
    );
    expect(schedulingEvent).toBeTruthy();
    expect(schedulingEvent.payload.schema_version).toBe(1);

    const transitionsResponse = await request.get(`/submissions/${submissionId}/transitions`);
    expect(transitionsResponse.status()).toBe(200);
    expect((await transitionsResponse.json())).toHaveLength(2);

    const integrationsResponse = await request.get(`/submissions/${submissionId}/integrations`);
    expect(integrationsResponse.status()).toBe(200);
    const integrationEvents = await integrationsResponse.json();
    expect(integrationEvents.length).toBeGreaterThanOrEqual(3);
    expect(
      integrationEvents.some(
        (event: { event_name: string }) => event.event_name === "submission.approved.scheduling.v1"
      )
    ).toBeTruthy();
  });

  test("[NR-010] forbidden transition path returns deterministic code", async ({ request }) => {
    const submissionId = uniqueId("sub-forbidden");
    const creatorHeaders = buildActorHeaders({ actorId: "creator-e2e", actorRoles: "creator" });

    const draftResponse = await request.post("/submissions/draft", {
      headers: creatorHeaders,
      data: {
        submission_id: submissionId,
        creator_id: "creator-e2e",
        preferred_release_month: "2026-11",
      },
    });
    expect(draftResponse.status()).toBe(200);

    const underReviewResponse = await request.post(`/submissions/${submissionId}/transition`, {
      headers: creatorHeaders,
      data: {
        request_id: uniqueId("req"),
        to_state: "under_review",
        actor_id: "creator-e2e",
        actor_role: "creator",
        expected_version: 0,
      },
    });
    expect(underReviewResponse.status()).toBe(200);

    const forbiddenResponse = await request.post(`/submissions/${submissionId}/transition`, {
      headers: creatorHeaders,
      data: {
        request_id: uniqueId("req"),
        to_state: "approved",
        actor_id: "creator-e2e",
        actor_role: "creator",
        expected_version: 1,
      },
    });
    expect(forbiddenResponse.status()).toBe(403);
    const forbiddenPayload = await forbiddenResponse.json();
    expect(forbiddenPayload.error.code).toBe("TRANSITION_FORBIDDEN");
  });
});
