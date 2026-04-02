const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("preload bridge exposes typed API and does not expose privileged primitives", () => {
  const preloadSource = fs.readFileSync(path.join(__dirname, "../electron/preload.js"), "utf8");

  assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld(\"splice\""));
  assert.equal(preloadSource.includes("require(\"./preloadApi\")"), false);
  assert.equal(preloadSource.includes("contextBridge.exposeInMainWorld(\"ipcRenderer\""), false);
  assert.equal(preloadSource.includes("contextBridge.exposeInMainWorld(\"electron\""), false);
});

test("renderer code avoids direct electron/node access", () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, "../src/renderer.js"), "utf8");

  assert.equal(rendererSource.includes("require(\"electron\")"), false);
  assert.equal(rendererSource.includes("require('electron')"), false);
  assert.equal(rendererSource.includes("process."), false);
});

test("renderer HTML defines CSP without unsafe script directives", () => {
  const htmlSource = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");

  assert.ok(htmlSource.includes("Content-Security-Policy"));
  assert.ok(htmlSource.includes("script-src 'self'"));
  assert.equal(htmlSource.includes("unsafe-inline"), false);
  assert.equal(htmlSource.includes("unsafe-eval"), false);
});
