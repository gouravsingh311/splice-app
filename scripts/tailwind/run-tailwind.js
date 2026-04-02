const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const watchMode = process.argv.includes('--watch');
const repoRoot = path.resolve(__dirname, '..', '..');
const cliEntry = path.join(repoRoot, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
let packageLock = null;
try {
  packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
} catch {
  packageLock = null;
}
const tailwindArgs = [cliEntry, '-i', './src/styles/input.css', '-o', './src/styles/output.css'];
if (watchMode) {
  tailwindArgs.push('--watch');
}

function getNativePackageNames() {
  const platformKey = `${process.platform}:${process.arch}`;
  const oxidePackages = {
    'darwin:arm64': '@tailwindcss/oxide-darwin-arm64',
    'darwin:x64': '@tailwindcss/oxide-darwin-x64',
    'linux:arm64': '@tailwindcss/oxide-linux-arm64-gnu',
    'linux:x64': '@tailwindcss/oxide-linux-x64-gnu',
    'win32:arm64': '@tailwindcss/oxide-win32-arm64-msvc',
    'win32:x64': '@tailwindcss/oxide-win32-x64-msvc',
  };
  const watcherPackages = {
    'darwin:arm64': '@parcel/watcher-darwin-arm64',
    'darwin:x64': '@parcel/watcher-darwin-x64',
    'linux:arm64': '@parcel/watcher-linux-arm64-glibc',
    'linux:x64': '@parcel/watcher-linux-x64-glibc',
    'win32:arm64': '@parcel/watcher-win32-arm64',
    'win32:x64': '@parcel/watcher-win32-x64',
  };

  const packages = [];
  const oxidePackage = oxidePackages[platformKey];
  if (oxidePackage) {
    packages.push({
      name: oxidePackage,
      baseDir: path.join(repoRoot, 'node_modules'),
    });
  }

  if (watchMode) {
    const watcherPackage = watcherPackages[platformKey];
    if (watcherPackage) {
      packages.push({
        name: watcherPackage,
        baseDir: path.join(repoRoot, 'node_modules'),
      });
    }
  }

  return packages;
}

function listMissingNativePackages() {
  return getNativePackageNames().filter(({ name, baseDir }) => {
    return !fs.existsSync(path.join(baseDir, name));
  });
}

function getLockedVersion(packageName) {
  if (!packageLock || !packageLock.packages) {
    return null;
  }

  const suffix = path.join('node_modules', packageName);
  for (const [packagePath, metadata] of Object.entries(packageLock.packages)) {
    if (packagePath === suffix || packagePath.endsWith(`/${suffix}`)) {
      return metadata && metadata.version ? metadata.version : null;
    }
  }

  return null;
}

function getPackageNameFromSpec(packageSpec) {
  const versionSeparator = packageSpec.lastIndexOf('@');
  if (versionSeparator <= 0) {
    return packageSpec;
  }

  return packageSpec.slice(0, versionSeparator);
}

function packOfflineDependency(packageSpec) {
  const result = spawnSync('npm', ['pack', '--offline', packageSpec], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (result.status !== 0) {
    return null;
  }

  const tarballName = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();

  if (!tarballName) {
    return null;
  }

  return path.join(repoRoot, tarballName);
}

function extractTarballToNodeModules(tarballPath, packageName) {
  const destinationDir = path.join(repoRoot, 'node_modules', packageName);
  fs.mkdirSync(destinationDir, { recursive: true });

  const result = spawnSync('tar', ['-xzf', tarballPath, '-C', destinationDir, '--strip-components=1'], {
    stdio: 'inherit',
  });

  if (result.status === 0) {
    try {
      fs.unlinkSync(tarballPath);
    } catch {
      // Best effort cleanup only.
    }
  }

  return result.status == null ? 1 : result.status;
}

function restoreOptionalDependencies(packagesToInstall) {
  for (const packageSpec of packagesToInstall) {
    const tarballPath = packOfflineDependency(packageSpec);
    if (!tarballPath) {
      return 1;
    }

    const packageName = getPackageNameFromSpec(packageSpec);
    const extractStatus = extractTarballToNodeModules(tarballPath, packageName);
    if (extractStatus !== 0) {
      return extractStatus;
    }
  }

  return 0;
}

function ensureNativeDependencies() {
  const missing = listMissingNativePackages();
  if (missing.length === 0) {
    return true;
  }

  process.stderr.write(
    `[build:css] Missing Tailwind optional native dependency${missing.length > 1 ? 'ies' : ''}: ${missing
      .map(({ name }) => name)
      .join(', ')}\n`,
  );
  const installSpecs = missing.map(({ name }) => {
    const lockedVersion = getLockedVersion(name);
    return lockedVersion ? `${name}@${lockedVersion}` : name;
  });
  process.stderr.write(`[build:css] Remediation: npm pack --offline ${installSpecs.join(' ')} && extract into node_modules\n`);
  process.stderr.write('[build:css] Retrying once after cache-backed optional dependency remediation.\n');

  const restoreStatus = restoreOptionalDependencies(installSpecs);
  if (restoreStatus !== 0) {
    process.stderr.write(`[build:css] Optional dependency remediation failed with exit code ${restoreStatus}.\n`);
    process.exit(restoreStatus);
  }

  const remaining = listMissingNativePackages();
  if (remaining.length > 0) {
    process.stderr.write(
      `[build:css] Tailwind optional native dependency still missing after remediation: ${remaining
        .map(({ name }) => name)
        .join(', ')}\n`,
    );
    process.stderr.write(
      '[build:css] Reinstall dependencies from the repository root before rerunning build:css.\n',
    );
    process.exit(1);
  }

  return true;
}

function runWithCurrentNode() {
  if (watchMode) {
    const child = spawn(process.execPath, tailwindArgs, { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code == null ? 1 : code));
    return;
  }
  const result = spawnSync(process.execPath, tailwindArgs, { stdio: 'inherit' });
  process.exit(result.status == null ? 1 : result.status);
}

function runWithNode20Fallback() {
  const args = ['-y', 'node@20', cliEntry, '-i', './src/styles/input.css', '-o', './src/styles/output.css'];
  if (watchMode) {
    args.push('--watch');
  }
  if (watchMode) {
    const child = spawn('npx', args, { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code == null ? 1 : code));
    return;
  }
  const result = spawnSync('npx', args, { stdio: 'inherit' });
  process.exit(result.status == null ? 1 : result.status);
}

const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) {
  ensureNativeDependencies();
  runWithCurrentNode();
} else {
  ensureNativeDependencies();
  runWithNode20Fallback();
}
