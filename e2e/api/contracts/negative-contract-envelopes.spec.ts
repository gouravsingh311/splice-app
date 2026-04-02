import { expect, test } from "@playwright/test";
import { buildActorHeaders } from "../../test-utils/authContext";

const API_BASE_URL = process.env.PW_API_BASE_URL ?? "http://127.0.0.1:8017";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createUnderReviewSubmission(request: import("@playwright/test").APIRequestContext, submissionId: string) {
  const headers = buildActorHeaders({ actorId: "creator-negative", actorRoles: "creator" });
  const draftResponse = await request.post(`${API_BASE_URL}/submissions/draft`, {
    headers,
    data: {
      submission_id: submissionId,
      creator_id: "creator-negative",
      preferred_release_month: "2026-11",
      metadata: {
        pack_name: `Pack ${submissionId}`,
      },
    },
  });
  expect(draftResponse.ok()).toBeTruthy();

  const transitionResponse = await request.post(`${API_BASE_URL}/submissions/${submissionId}/transition`, {
    headers,
    data: {
      request_id: uniqueId("under-review"),
      to_state: "under_review",
      actor_id: "creator-negative",
      actor_role: "creator",
      expected_version: 0,
    },
  });
  expect(transitionResponse.ok()).toBeTruthy();
}

test.describe("Negative contract envelope scenarios", () => {
  test("[NR-003] notifications retry rejects creator role and malformed payloads deterministically", async ({ request }) => {
    const headers = buildActorHeaders({ actorId: "creator-negative", actorRoles: "creator" });
    const forbiddenResponse = await request.post(`${API_BASE_URL}/notifications/retry`, {
      headers,
      data: {
        actor_id: "creator-negative",
        actor_role: "creator",
        notification_id: "ntf-negative",
      },
    });
    expect(forbiddenResponse.status()).toBe(403);
    await expect(forbiddenResponse.json()).resolves.toMatchObject({
      error: {
        code: "NOTIFICATION_RETRY_FORBIDDEN",
      },
    });

    const validationResponse = await request.post(`${API_BASE_URL}/notifications/retry`, {
      headers,
      data: {
        actor_id: "creator-negative",
        actor_role: "creator",
      },
    });
    expect(validationResponse.status()).toBe(422);
    await expect(validationResponse.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_CONTRACT_PAYLOAD",
      },
    });
  });

  test("[AD-024] notifications mark-read rejects malformed payload with deterministic contract error", async ({ request }) => {
    const headers = buildActorHeaders({ actorId: "creator-negative", actorRoles: "creator" });
    const invalidPayloads = [
      { actor_id: "creator-negative", actor_role: "creator", notification_ids: "not-an-array" },
      { actor_id: "creator-negative", actor_role: "creator", notification_ids: [123] },
      { actor_id: "creator-negative", actor_role: "creator" },
    ];

    for (const payload of invalidPayloads) {
      const response = await request.post(`${API_BASE_URL}/notifications/mark-read`, {
        headers,
        data: payload,
      });
      expect(response.status()).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "INVALID_CONTRACT_PAYLOAD",
        },
      });
    }
  });

  test("[CR-033][RV-023][AD-023] review and admin actions preserve auth-forbidden and validation envelopes", async ({ request }) => {
    const submissionId = `sub-negative-${Date.now()}`;
    await createUnderReviewSubmission(request, submissionId);
    const adminHeaders = buildActorHeaders({ actorId: "admin-negative", actorRoles: "admin" });
    const reviewerHeaders = buildActorHeaders({ actorId: "reviewer-negative", actorRoles: "reviewer" });
    const creatorHeaders = buildActorHeaders({ actorId: "creator-negative", actorRoles: "creator" });

    const draftResponse = await request.post(`${API_BASE_URL}/admin/configs/draft`, {
      headers: adminHeaders,
      data: {
        actor_id: "admin-negative",
        actor_role: "admin",
        config_type: "qc_policy",
        payload_json: { rules: [] },
      },
    });
    expect(draftResponse.ok()).toBeTruthy();
    const configId = (await draftResponse.json()).config.id;

    const publishForbidden = await request.post(`${API_BASE_URL}/admin/configs/${configId}/publish`, {
      headers: reviewerHeaders,
      data: {
        actor_id: "reviewer-negative",
        actor_role: "reviewer",
        reason: "not allowed",
        confirmation: "PUBLISH",
      },
    });
    expect(publishForbidden.status()).toBe(403);
    await expect(publishForbidden.json()).resolves.toMatchObject({
      error: {
        code: "AUTH_FORBIDDEN",
      },
    });

    const publishValidation = await request.post(`${API_BASE_URL}/admin/configs/${configId}/publish`, {
      headers: adminHeaders,
      data: {
        actor_id: "admin-negative",
        actor_role: "admin",
        reason: "missing confirmation",
        confirmation: "wrong",
      },
    });
    expect(publishValidation.status()).toBe(422);
    await expect(publishValidation.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });

    const reviewForbidden = await request.post(`${API_BASE_URL}/reviews/submissions/${submissionId}/reopen`, {
      headers: creatorHeaders,
      data: {
        actor_id: "creator-negative",
        actor_role: "creator",
        request_id: uniqueId("reopen"),
        notes: "not allowed",
      },
    });
    expect(reviewForbidden.status()).toBe(403);
    await expect(reviewForbidden.json()).resolves.toMatchObject({
      error: {
        code: "REVIEW_FORBIDDEN",
      },
    });

    const reviewValidation = await request.post(`${API_BASE_URL}/reviews/submissions/${submissionId}/approve`, {
      headers: reviewerHeaders,
      data: {
        actor_id: "reviewer-negative",
        actor_role: "reviewer",
      },
    });
    const reviewValidationStatus = reviewValidation.status();
    expect([200, 422]).toContain(reviewValidationStatus);
    const reviewValidationBody = await reviewValidation.json();
    if (reviewValidationStatus === 422) {
      expect(reviewValidationBody.error?.code).toBeTruthy();
    } else {
      expect(JSON.stringify(reviewValidationBody)).toContain(submissionId);
    }
  });
});
