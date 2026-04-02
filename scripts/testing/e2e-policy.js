const { execFileSync } = require('node:child_process');

function isRealSmokeRun(env = process.env) {
  return env.RUN_REAL_SMOKE === '1';
}

function assertRealSmokeAuthStubDisabled({
  requestedAuthStub,
} = {}) {
  if (requestedAuthStub === true) {
    throw new Error('Auth stub mode has been removed and cannot be enabled.');
  }
}

function resolveAuthStubEnabled({
  requestedAuthStub,
  env = process.env,
  context = 'E2E launch',
} = {}) {
  assertRealSmokeAuthStubDisabled({ requestedAuthStub, env, context });
  return false;
}

function quoteSqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  const text = value instanceof Date ? value.toISOString() : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function bindSql(sql, params) {
  let index = 0;
  return sql.replace(/\?/g, () => quoteSqlValue(params[index++]));
}

function createReadOnlySqliteFallback(dbPath) {
  class CliStatement {
    constructor(sql) {
      this.sql = sql;
    }

    get(...params) {
      const boundSql = bindSql(this.sql, params);
      const stdout = execFileSync('/usr/bin/sqlite3', ['-json', dbPath, boundSql], {
        encoding: 'utf8',
      }).trim();

      if (!stdout) {
        return undefined;
      }

      const rows = JSON.parse(stdout);
      return rows[0];
    }

    run() {
      throw new Error('Read-only sqlite CLI fallback cannot execute writes; install better-sqlite3 for write access.');
    }
  }

  return {
    prepare(sql) {
      return new CliStatement(sql);
    },
    close() {},
  };
}

module.exports = {
  assertRealSmokeAuthStubDisabled,
  createReadOnlySqliteFallback,
  isRealSmokeRun,
  resolveAuthStubEnabled,
};
