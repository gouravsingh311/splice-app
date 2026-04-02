const { ActorRoleSchema } = require("./contracts");

const ROLE_PERMISSIONS = Object.freeze({
  creator: Object.freeze(["submission:create", "submission:read:self"]),
  reviewer: Object.freeze(["submission:read:all", "submission:review", "audit:read"]),
  admin: Object.freeze(["*"]),
});

function parseRoles(rawRoles) {
  if (!rawRoles) {
    return ["creator"];
  }

  const parsedRoles = String(rawRoles)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .filter((value) => ActorRoleSchema.safeParse(value).success);

  return parsedRoles.length > 0 ? parsedRoles : ["creator"];
}

function resolveAuthContext() {
  return {
    actorId: process.env.FILEEATERS_ACTOR_ID || "local-dev-actor",
    roles: parseRoles(process.env.FILEEATERS_AUTH_ROLES),
    sessionIssuedAt: new Date().toISOString(),
  };
}

function buildPermissions(roles) {
  const permissions = new Set();
  for (const role of roles) {
    const rolePermissions = ROLE_PERMISSIONS[role] || [];
    rolePermissions.forEach((permission) => permissions.add(permission));
  }

  return Array.from(permissions);
}

function buildAuthSessionData(actorContext, includePermissions) {
  return {
    actor: {
      id: actorContext.actorId,
      roles: actorContext.roles,
    },
    permissions: includePermissions ? buildPermissions(actorContext.roles) : [],
    sessionIssuedAt: actorContext.sessionIssuedAt,
  };
}

module.exports = {
  buildAuthSessionData,
  buildPermissions,
  resolveAuthContext,
};
