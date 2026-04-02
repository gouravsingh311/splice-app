const fs = require('fs/promises');
const path = require('path');

const bannedDeps = [
  'shadcn',
  '@radix-ui/',
  'class-variance-authority',
  'tailwind-merge',
  'tailwindcss-animate',
];

const bannedPatterns = [
  { label: '@radix-ui imports', match: 'from "@radix-ui/' },
  { label: '@radix-ui requires', match: "require('@radix-ui/" },
  { label: 'shadcn mention', match: 'shadcn' },
  { label: 'class-variance-authority', match: 'class-variance-authority' },
  { label: 'tailwind-merge', match: 'tailwind-merge' },
  { label: 'tailwindcss-animate', match: 'tailwindcss-animate' },
  { label: 'twMerge helper', match: 'twMerge(' },
];

const skipDirs = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'docs/reports/assets', 'apps']);
const fileExtensions = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.html', '.css', '.json']);

const guardScriptRelative = path.join('scripts', 'guards', 'ui-stack-guard.js');

async function collectFiles(dir, root = dir, list = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const rel = path.relative(root, entryPath);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || rel.startsWith('node_modules')) {
        continue;
      }
      await collectFiles(entryPath, root, list);
    } else {
      if (entry.name === 'package-lock.json') {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (rel === guardScriptRelative) {
        continue;
      }
      if (fileExtensions.has(ext)) {
        list.push(entryPath);
      }
    }
  }
  return list;
}

async function readPackage(baseDir) {
  const packagePath = path.join(baseDir, 'package.json');
  const text = await fs.readFile(packagePath, 'utf8');
  return JSON.parse(text);
}

function checkDependencies(pkg, errors) {
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ];
  for (const banned of bannedDeps) {
    if (banned.endsWith('/')) {
      const prefix = banned;
      const match = allDeps.find(dep => dep.startsWith(prefix));
      if (match) {
        errors.push(`Banned dependency "${match}" matches prefix "${prefix}"`);
      }
      continue;
    }
    if (allDeps.includes(banned)) {
      errors.push(`Banned dependency "${banned}" declared in package.json`);
    }
  }
}

async function checkPatterns(files, errors) {
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      for (const rule of bannedPatterns) {
        if (content.includes(rule.match)) {
          errors.push(`Pattern violation in ${file}: ${rule.label} (${rule.match})`);
        }
      }
    } catch (error) {
      errors.push(`Failed to read ${file}: ${error.message}`);
    }
  }
}

async function runGuard(baseDir = process.cwd(), options = {}) {
  const pkg = options.packageJson || await readPackage(baseDir);
  const errors = [];
  checkDependencies(pkg, errors);
  const files = options.files || await collectFiles(baseDir);
  await checkPatterns(files, errors);
  if (errors.length) {
    const message = ['UI stack guard detected violations:'];
    for (const error of errors) {
      message.push(`  • ${error}`);
    }
    const err = new Error(message.join('\n'));
    err.details = errors;
    throw err;
  }
  return true;
}

if (require.main === module) {
  runGuard(process.cwd())
    .then(() => {
      process.stdout.write('UI stack guard passed.\n');
    })
    .catch(err => {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    });
}

module.exports = { runGuard };
