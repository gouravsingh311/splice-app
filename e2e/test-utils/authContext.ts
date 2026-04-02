export type E2EActorRole = "admin" | "creator" | "reviewer" | "system";

export const DEFAULT_E2E_AUTH_ACCESS_SECRET = "local-dev-secret-change-me";
export const DEFAULT_E2E_INTERNAL_API_TOKEN = "local-dev-internal-token";

const ALLOWED_ROLES = new Set<E2EActorRole>(["admin", "creator", "reviewer", "system"]);

export function resolveEnvOrDefault(rawValue: string | undefined | null, fallbackValue: string): string {
  const normalized = String(rawValue ?? "").trim();
  return normalized.length > 0 ? normalized : fallbackValue;
}

export function normalizeActorRoles(rawRoles?: string | string[] | null): E2EActorRole[] {
  const values = Array.isArray(rawRoles)
    ? rawRoles
    : String(rawRoles ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

  const normalized = values
    .map((value) => value.toLowerCase() as E2EActorRole)
    .filter((value): value is E2EActorRole => ALLOWED_ROLES.has(value));

  return Array.from(new Set(normalized));
}

export function resolvePrimaryActorRole(rawRoles?: string | string[] | null): E2EActorRole {
  const roles = normalizeActorRoles(rawRoles);
  if (roles.includes("admin")) {
    return "admin";
  }
  if (roles.includes("reviewer")) {
    return "reviewer";
  }
  if (roles.includes("creator")) {
    return "creator";
  }
  if (roles.includes("system")) {
    return "system";
  }
  return "creator";
}

export function buildActorHeaders(options: {
  actorId?: string | null;
  actorRoles?: string | string[] | null;
  internalToken?: string | null;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  const actorId = String(options.actorId ?? "").trim();
  if (actorId) {
    headers["X-Actor-Id"] = actorId;
  }

  const actorRole = resolvePrimaryActorRole(options.actorRoles ?? null);
  if (actorRole) {
    headers["X-Actor-Role"] = actorRole;
  }

  const internalToken = String(options.internalToken ?? "").trim();
  if (internalToken) {
    headers["X-Internal-Token"] = internalToken;
  }

  return headers;
}

export function mergeHeaders(
  headers: HeadersInit | undefined,
  extraHeaders: Record<string, string>,
): Headers {
  const merged = new Headers(headers ?? {});
  for (const [key, value] of Object.entries(extraHeaders)) {
    merged.set(key, value);
  }
  return merged;
}

export function buildAuthenticatedFetchInit(
  init: RequestInit | undefined,
  options: {
    actorId?: string | null;
    actorRoles?: string | string[] | null;
    internalToken?: string | null;
  },
): RequestInit {
  return {
    ...(init ?? {}),
    headers: mergeHeaders(init?.headers, buildActorHeaders(options)),
  };
}
