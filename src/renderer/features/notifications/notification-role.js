(function (global) {
  function normalizeRoles(input) {
    if (!Array.isArray(input)) { return []; }
    return input.map(function (value) { return String(value || '').toLowerCase().trim(); }).filter(Boolean);
  }

  function resolvePrimaryActorRole(rolesInput) {
    var roles = normalizeRoles(rolesInput);
    if (roles.length === 0) {
      return {
        role: 'creator',
        violation: false,
        reason: 'missing',
        roles: roles,
      };
    }

    if (roles.length === 1) {
      return {
        role: roles[0],
        violation: false,
        reason: 'single',
        roles: roles,
      };
    }

    var priority = ['admin', 'reviewer', 'creator'];
    for (var i = 0; i < priority.length; i += 1) {
      if (roles.indexOf(priority[i]) !== -1) {
        return {
          role: priority[i],
          violation: true,
          reason: 'multiple',
          roles: roles,
        };
      }
    }

    return {
      role: roles[0],
      violation: true,
      reason: 'multiple-unknown',
      roles: roles,
    };
  }

  global.resolvePrimaryActorRole = resolvePrimaryActorRole;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
