#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  assertRealSmokeAuthStubDisabled,
} = require('./e2e-policy');

const repoRoot = path.resolve(__dirname, '..', '..');
const specsDir = path.join(repoRoot, 'e2e', 'electron');

const allowlist = new Set([
  'admin/policy-feedback.spec.ts',
  'creator/airtable-qc-remediation.spec.ts',
  'creator/dashboard.spec.ts',
  'creator/submission-lifecycle.spec.ts',
  'resilience/degraded-recovery.spec.ts',
  'resilience/notifications-resilience.spec.ts',
]);

function listSpecFilesRecursive(rootDir) {
  const files = [];
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(rootDir, relDir);
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.posix.join(relDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(relPath);
        continue;
      }
      if (entry.isFile() && relPath.endsWith('.spec.ts')) {
        files.push(relPath);
      }
    }
  }
  return files.sort();
}

const specFiles = listSpecFilesRecursive(specsDir);

const violations = [];

for (const specFile of specFiles) {
  const source = fs.readFileSync(path.join(specsDir, specFile), 'utf8');
  const hasPageEvaluate = /\bpage\.evaluate\s*\(/.test(source);
  const hasElectronApiPatch =
    source.includes('(window as any).electronAPI =') ||
    source.includes('const api = (window as any).electronAPI') ||
    /api\.[a-zA-Z0-9_]+\s*=\s*async/.test(source);

  if (hasPageEvaluate && hasElectronApiPatch && !allowlist.has(specFile)) {
    violations.push(specFile);
  }
}

if (violations.length) {
  console.error('E2E stub guard failed. Unauthorized window.electronAPI monkey patching found in:');
  for (const file of violations) {
    console.error(`- e2e/electron/${file}`);
  }
  console.error('If intentional, move the seam into shared helpers or update the allowlist with justification.');
  process.exit(1);
}

assertRealSmokeAuthStubDisabled({ env: process.env, context: 'E2E stub guard' });

console.log('E2E stub guard passed. No unauthorized window.electronAPI monkey patches detected.');
