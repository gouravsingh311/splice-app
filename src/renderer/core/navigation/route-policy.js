(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspaceRoutePolicy = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var CREATOR_PRIMARY_ROUTES = Object.freeze([
    'dashboard',
    'submissions',
    'notifications',
    'settings',
  ]);

  var CANONICAL_ROUTE_ALIASES = Object.freeze({
    'upload-qc': 'submissions',
    'qc-results': 'submissions',
    'submission-detail': 'submissions',
    'submissions-history': 'submissions',
  });

  function normalizeRoles(roles) {
    if (!Array.isArray(roles)) {
      return [];
    }
    return roles
      .map(function (role) { return String(role || '').trim().toLowerCase(); })
      .filter(Boolean);
  }

  function isCreatorScopedRole(roles) {
    var normalized = normalizeRoles(roles);
    if (normalized.length === 0) {
      return true;
    }
    return normalized.indexOf('creator') !== -1;
  }

  function resolveRoute(requestedViewId, roles) {
    var requested = String(requestedViewId || '').trim();
    if (CANONICAL_ROUTE_ALIASES[requested]) {
      return {
        requestedView: requested,
        resolvedView: CANONICAL_ROUTE_ALIASES[requested],
        redirected: true,
        reason: 'Alias route normalized to canonical workspace destination.',
      };
    }
    return {
      requestedView: requested,
      resolvedView: requested,
      redirected: false,
      reason: '',
    };
  }

  return {
    CREATOR_PRIMARY_ROUTES: CREATOR_PRIMARY_ROUTES,
    isCreatorScopedRole: isCreatorScopedRole,
    CANONICAL_ROUTE_ALIASES: CANONICAL_ROUTE_ALIASES,
    resolveRoute: resolveRoute,
  };
});
