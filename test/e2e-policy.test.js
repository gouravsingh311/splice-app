const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertRealSmokeAuthStubDisabled,
  createReadOnlySqliteFallback,
  resolveAuthStubEnabled,
} = require('../scripts/testing/e2e-policy');

test('resolveAuthStubEnabled keeps stub mode disabled in strict real-smoke runs', () => {
  assert.equal(
    resolveAuthStubEnabled({
      requestedAuthStub: false,
      env: { ...process.env, RUN_REAL_SMOKE: '1' },
      context: 'test',
    }),
    false,
  );

  assert.throws(
    () =>
      resolveAuthStubEnabled({
        requestedAuthStub: true,
        env: { ...process.env, RUN_REAL_SMOKE: '1' },
        context: 'test',
      }),
    /Auth stub mode has been removed/,
  );
});

test('assertRealSmokeAuthStubDisabled rejects accidental stub usage', () => {
  assert.throws(
    () =>
      assertRealSmokeAuthStubDisabled({
        env: { ...process.env, RUN_REAL_SMOKE: '1' },
        requestedAuthStub: true,
        context: 'real-smoke',
      }),
    /Auth stub mode has been removed/,
  );
});

test('read-only sqlite fallback refuses writes', () => {
  const db = createReadOnlySqliteFallback('/tmp/fallback-test.db');
  const statement = db.prepare('UPDATE example SET value = ? WHERE id = ?');

  assert.throws(
    () => statement.run('blocked', 1),
    /cannot execute writes/,
  );
});
