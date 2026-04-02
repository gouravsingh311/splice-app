const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TARGET_DIRECTORIES = ["electron", "src", "test", "scripts"];
const SKIP_DIRECTORIES = new Set(["node_modules", "coverage", "dist", "out", "build"]);
const SKIP_FILE_SUFFIXES = [".stories.js"];
const SKIP_FILE_SEGMENTS = [
  `${path.sep}apps${path.sep}api${path.sep}build${path.sep}`,
  `${path.sep}src${path.sep}stories${path.sep}`,
];

function collectJavaScriptFiles(startDirectory) {
  const queue = [startDirectory];
  const files = [];

  while (queue.length > 0) {
    const currentDirectory = queue.pop();
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          queue.push(entryPath);
        }
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".js")) {
        if (SKIP_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
          continue;
        }
        if (SKIP_FILE_SEGMENTS.some((segment) => entryPath.includes(segment))) {
          continue;
        }
        files.push(entryPath);
      }
    }
  }

  return files;
}

module.exports = {
  collectJavaScriptFiles,
};

function runSyntaxCheck(filePath) {
  const checkProcess = spawnSync(process.execPath, ["--check", filePath], {
    stdio: "pipe",
    encoding: "utf8",
  });

  if (checkProcess.status !== 0) {
    throw new Error(`Syntax validation failed for ${filePath}:\n${checkProcess.stderr}`);
  }
}

function assertRendererIsolation() {
  const rendererPath = path.join(PROJECT_ROOT, "src/renderer.js");
  const rendererSource = fs.readFileSync(rendererPath, "utf8");

  const forbiddenRendererPatterns = [
    "require(\"electron\")",
    "require('electron')",
    "require(\"node:",
    "require('node:",
    "process.",
  ];

  for (const forbiddenPattern of forbiddenRendererPatterns) {
    if (rendererSource.includes(forbiddenPattern)) {
      throw new Error(`Renderer isolation violation: found ${forbiddenPattern} in ${rendererPath}`);
    }
  }

  const preloadPath = path.join(PROJECT_ROOT, "electron/preload.js");
  const preloadSource = fs.readFileSync(preloadPath, "utf8");

  if (!preloadSource.includes("contextBridge.exposeInMainWorld")) {
    throw new Error(`Preload bridge contract missing in ${preloadPath}`);
  }

  const forbiddenPreloadExposures = [
    /contextBridge\.exposeInMainWorld\(\s*["']ipcRenderer["']/,
    /contextBridge\.exposeInMainWorld\(\s*["']electron["']/,
    /contextBridge\.exposeInMainWorld\(\s*["']require["']/,
  ];

  for (const forbiddenExposure of forbiddenPreloadExposures) {
    if (forbiddenExposure.test(preloadSource)) {
      throw new Error(`Preload must not expose privileged API directly in ${preloadPath}`);
    }
  }
}

function assertRendererSecurityBaseline() {
  const htmlEntryPath = path.join(PROJECT_ROOT, "src/index.html");
  const htmlEntrySource = fs.readFileSync(htmlEntryPath, "utf8");

  if (!htmlEntrySource.includes("Content-Security-Policy")) {
    throw new Error(`Missing Content-Security-Policy declaration in ${htmlEntryPath}`);
  }

  if (!htmlEntrySource.includes("script-src 'self'")) {
    throw new Error(`CSP must include script-src 'self' in ${htmlEntryPath}`);
  }

  const disallowedCspPatterns = ["unsafe-inline", "unsafe-eval"];
  for (const disallowedPattern of disallowedCspPatterns) {
    if (htmlEntrySource.includes(disallowedPattern)) {
      throw new Error(`Disallowed CSP token "${disallowedPattern}" found in ${htmlEntryPath}`);
    }
  }

  if (/<script[^>]+src=["']https?:\/\//i.test(htmlEntrySource)) {
    throw new Error(`Remote script include found in ${htmlEntryPath}; use local bundle assets only`);
  }
}

function main() {
  const allFiles = TARGET_DIRECTORIES.flatMap((directoryName) =>
    collectJavaScriptFiles(path.join(PROJECT_ROOT, directoryName)),
  );

  for (const filePath of allFiles) {
    runSyntaxCheck(filePath);
  }

  assertRendererIsolation();
  assertRendererSecurityBaseline();

  process.stdout.write(`Validated ${allFiles.length} JavaScript files.\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
