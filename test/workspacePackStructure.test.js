const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMissingRequiredFolderGuidance,
  buildStructureGateMessage,
  isKnownTopLevelFolder,
  resolveTopLevelFolderChecklist,
  resolveMissingRequiredTopLevelFolders,
} = require("../src/renderer/workspace/pack-structure.js");

test("resolveMissingRequiredTopLevelFolders accepts PRD aliases", () => {
  const missing = resolveMissingRequiredTopLevelFolders([
    "audio",
    "cover art",
    "Demos",
    "Description & Info",
    "MIDI",
  ]);
  assert.deepEqual(missing, []);
});

test("resolveMissingRequiredTopLevelFolders returns missing required groups", () => {
  const missing = resolveMissingRequiredTopLevelFolders(["Audio", "Artwork"]);
  assert.deepEqual(missing, ["Demo/Demos", "Description/Description & Info"]);
});

test("buildStructureGateMessage uses Phase 1 blocked wording when missing folders exist", () => {
  const message = buildStructureGateMessage(["Audio"]);
  assert.match(message, /Phase 1 submission is blocked/i);
  assert.match(message, /Audio/);
});

test("buildMissingRequiredFolderGuidance uses plain-language alias guidance", () => {
  const guidance = buildMissingRequiredFolderGuidance([
    "Artwork/Cover Art",
    "Description/Description & Info",
  ]);
  assert.match(guidance, /Add these folders at the top level/i);
  assert.match(guidance, /Artwork or Cover Art/i);
  assert.match(guidance, /Description or Description & Info/i);
});

test("resolveTopLevelFolderChecklist reports required and optional folder status", () => {
  const checklist = resolveTopLevelFolderChecklist(["Audio", "Cover Art", "MIDI"]);
  const byId = Object.fromEntries(checklist.map((item) => [item.id, item]));

  assert.equal(byId.audio.present, true);
  assert.equal(byId.artwork.present, true);
  assert.equal(byId.demo.present, false);
  assert.equal(byId.description.present, false);
  assert.equal(byId.midi.required, false);
  assert.equal(byId.midi.present, true);
});

test("isKnownTopLevelFolder supports optional folder aliases", () => {
  assert.equal(isKnownTopLevelFolder("Presets"), true);
  assert.equal(isKnownTopLevelFolder("midi"), true);
  assert.equal(isKnownTopLevelFolder("Bass"), false);
});
