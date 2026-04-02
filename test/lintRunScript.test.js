const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { collectJavaScriptFiles } = require("../scripts/lint/run.js");

test("lint collector excludes storybook ESM files and build artifacts", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lint-run-"));
  fs.mkdirSync(path.join(tempRoot, "src", "stories"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "src", "app"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "src", "build"), { recursive: true });

  const storyFile = path.join(tempRoot, "src", "stories", "Notifications.stories.js");
  const appFile = path.join(tempRoot, "src", "app", "renderer.js");
  const buildFile = path.join(tempRoot, "src", "build", "bundle.js");

  fs.writeFileSync(storyFile, "import x from './x.js';\n");
  fs.writeFileSync(appFile, "module.exports = {};\n");
  fs.writeFileSync(buildFile, "module.exports = {};\n");

  const files = collectJavaScriptFiles(path.join(tempRoot, "src"));

  assert.equal(files.includes(storyFile), false);
  assert.equal(files.includes(buildFile), false);
  assert.equal(files.includes(appFile), true);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
