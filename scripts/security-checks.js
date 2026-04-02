const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "coverage",
  "dist",
  "out",
  "build",
  ".venv",
  ".ruff_cache",
  "test-results",
]);
const SKIP_PATH_SEGMENTS = [
  `${path.sep}apps${path.sep}api${path.sep}build${path.sep}`,
  `${path.sep}docs${path.sep}reports${path.sep}assets${path.sep}`,
];
const ALLOWED_PASSWORD_FILES = new Set([
  "apps/api/app/features/auth/contracts.py",
  "apps/api/tests/test_auth_endpoints.py",
  "src/renderer/core/auth/state.js",
  "e2e/electron/admin/policy-feedback.spec.ts",
  "e2e/electron/auth/session-edge.spec.ts",
  "e2e/electron/auth/core.spec.ts",
  "e2e/electron/creator/dashboard.spec.ts",
  "e2e/electron/resilience/degraded-recovery.spec.ts",
  "e2e/electron/accessibility/notifications-dropdown.spec.ts",
  "e2e/electron/resilience/durability.spec.ts",
  "e2e/electron/resilience/notifications-resilience.spec.ts",
  "e2e/electron/resilience/notifications-core.spec.ts",
  "e2e/electron/creator/qc-routing-regression.spec.ts",
  "e2e/electron/reviewer/decision-flow.spec.ts",
  "e2e/electron/creator/shell-navigation.spec.ts",
  "e2e/electron/creator/submission-lifecycle.spec.ts",
  "e2e/electron/support.ts",
  "e2e/electron/creator/airtable-qc-remediation.spec.ts",
  "scripts/testing/run-admin-policy-qc-ui-scenario.mjs",
  "scripts/demo-media/shot-list.js",
  "test/authBackendClient.test.js",
  "test/ipcContracts.test.js",
  "test/ipcRouter.test.js",
  "test/preloadBridgeContract.test.js",
  "test/securityChecks.test.js",
  "e2e/electron/admin/ops-notifications-ui.spec.ts",
]);
const ALLOWED_SECRET_FILES = new Set([
  ".env.example",
  ".env.local.example",
  ".env.dev.example",
  ".env.staging.example",
  ".env.prod.example",
]);

const SECRET_PATTERNS = [
  { name: "AWS access key", expression: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub token", expression: /ghp_[A-Za-z0-9]{36}/g },
  { name: "Generic private key", expression: /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/g },
  { name: "Slack token", expression: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  {
    name: "Hardcoded password",
    expression:
      /\b(?:password|passwd|pwd)\b\s*[:=]\s*["'](?!test|fake|mock|example|placeholder|dummy)[^"']{12,}["']/gi,
  },
];

function shouldSkipDirectory(entryName) {
  if (entryName.startsWith(".")) {
    return !entryName.startsWith(".env");
  }

  return SKIP_DIRECTORIES.has(entryName);
}

function collectFiles(rootDirectory) {
  const queue = [rootDirectory];
  const files = [];

  while (queue.length > 0) {
    const currentDirectory = queue.pop();
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (SKIP_PATH_SEGMENTS.some((segment) => absolutePath.includes(segment))) {
        continue;
      }

      files.push(absolutePath);
    }
  }

  return files;
}

function getFindings(rootDirectory = PROJECT_ROOT) {
  const findings = [];
  const files = collectFiles(rootDirectory);

  for (const filePath of files) {
    const relativePath = path.relative(rootDirectory, filePath);

    if (ALLOWED_SECRET_FILES.has(relativePath)) {
      continue;
    }

    const fileContents = fs.readFileSync(filePath, "utf8");

    for (const { name, expression } of SECRET_PATTERNS) {
      if (name === "Hardcoded password" && ALLOWED_PASSWORD_FILES.has(relativePath)) {
        continue;
      }
      expression.lastIndex = 0;

      if (expression.test(fileContents)) {
        findings.push(`${name} match in ${relativePath}`);
      }
    }
  }

  return { findings, totalFiles: files.length };
}

function main() {
  const { findings, totalFiles } = getFindings(PROJECT_ROOT);

  if (findings.length > 0) {
    process.stderr.write(`Secret scan failed:\n${findings.join("\n")}\n`);
    process.exit(1);
  }

  process.stdout.write(`Secret scan passed for ${totalFiles} files.\n`);
}

module.exports = {
  collectFiles,
  getFindings,
  SECRET_PATTERNS,
};

if (require.main === module) {
  main();
}
