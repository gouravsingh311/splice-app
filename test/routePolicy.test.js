const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_ROUTE_ALIASES,
  CREATOR_PRIMARY_ROUTES,
  resolveRoute,
} = require('../src/renderer/core/navigation/route-policy.js');

test('route policy keeps frozen creator-primary route map', () => {
  assert.deepEqual(CREATOR_PRIMARY_ROUTES, ['dashboard', 'submissions', 'notifications', 'settings']);
  assert.equal(CANONICAL_ROUTE_ALIASES['submissions-history'], 'submissions');
});

test('route policy preserves non-deprecated routes', () => {
  const resolved = resolveRoute('notifications', ['creator']);
  assert.equal(resolved.redirected, false);
  assert.equal(resolved.resolvedView, 'notifications');
});

test('route policy normalizes submissions history alias to canonical submissions route', () => {
  const resolved = resolveRoute('submissions-history', ['creator']);
  assert.equal(resolved.redirected, true);
  assert.equal(resolved.resolvedView, 'submissions');
});
