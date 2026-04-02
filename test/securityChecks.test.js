const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { getFindings } = require("../scripts/security-checks.js");

function writeFile(base, relativePath, content) {
  const absolutePath = path.join(base, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

test("security checks detect real credential patterns", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "security-checks-positive-"));
  writeFile(tempRoot, "src/app.js", 'const password = "SuperSecretCredential1234";\n');

  const { findings } = getFindings(tempRoot);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /Hardcoded password match/);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("security checks allow known fixture path and skip generated/docs artifact paths", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "security-checks-allowed-"));
  writeFile(
    tempRoot,
    "e2e/electron/auth.spec.ts",
    'const password = "fixture-password-for-login";\n',
  );
  writeFile(
    tempRoot,
    "apps/api/build/lib/app/features/auth/contracts.py",
    'password = "GeneratedBuildShouldBeIgnored123";\n',
  );
  writeFile(
    tempRoot,
    "docs/reports/assets/sample.log",
    'password = "DocAssetShouldBeIgnored12345";\n',
  );

  const { findings } = getFindings(tempRoot);
  assert.equal(findings.length, 0);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
