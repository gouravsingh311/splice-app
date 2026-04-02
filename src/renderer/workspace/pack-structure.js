(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.workspacePackStructure = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var REQUIRED_TOP_LEVEL_FOLDER_GROUPS = Object.freeze([
    Object.freeze({
      id: 'audio',
      label: 'Audio',
      aliases: Object.freeze(['Audio']),
    }),
    Object.freeze({
      id: 'artwork',
      label: 'Artwork/Cover Art',
      aliases: Object.freeze(['Artwork', 'Cover Art']),
    }),
    Object.freeze({
      id: 'demo',
      label: 'Demo/Demos',
      aliases: Object.freeze(['Demo', 'Demos']),
    }),
    Object.freeze({
      id: 'description',
      label: 'Description/Description & Info',
      aliases: Object.freeze(['Description', 'Description & Info', 'Description and Info']),
    }),
  ]);

  var OPTIONAL_TOP_LEVEL_FOLDER_GROUPS = Object.freeze([
    Object.freeze({
      id: 'presets',
      label: 'Presets',
      aliases: Object.freeze(['Presets']),
    }),
    Object.freeze({
      id: 'midi',
      label: 'MIDI',
      aliases: Object.freeze(['MIDI']),
    }),
  ]);

  var REQUIRED_FOLDERS_PHASE1_COPY = (
    'Phase 1 requires top-level folders: Audio, Artwork/Cover Art, Demo/Demos, ' +
    'Description/Description & Info. Presets and MIDI are optional.'
  );

  function normalizeFolderKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '');
  }

  function resolveAliasKeys(aliases) {
    return (aliases || [])
      .map(normalizeFolderKey)
      .filter(Boolean);
  }

  function resolveMissingRequiredTopLevelFolders(topLevelFolders) {
    var available = new Set(
      (Array.isArray(topLevelFolders) ? topLevelFolders : [])
        .map(normalizeFolderKey)
        .filter(Boolean)
    );

    return REQUIRED_TOP_LEVEL_FOLDER_GROUPS
      .filter(function (group) {
        var aliasKeys = resolveAliasKeys(group.aliases);
        var matched = aliasKeys.some(function (aliasKey) { return available.has(aliasKey); });
        return !matched;
      })
      .map(function (group) { return group.label; });
  }

  function buildStructureGateMessage(missingRequiredFolders) {
    if (!Array.isArray(missingRequiredFolders) || missingRequiredFolders.length === 0) {
      return (
        'Phase 1 required top-level folders detected ' +
        '(Audio, Artwork/Cover Art, Demo/Demos, Description/Description & Info).'
      );
    }
    return (
      'Phase 1 submission is blocked until required top-level folders are present: ' +
      missingRequiredFolders.join(', ') +
      '.'
    );
  }

  function buildMissingRequiredFolderGuidance(missingRequiredFolders) {
    if (!Array.isArray(missingRequiredFolders) || missingRequiredFolders.length === 0) {
      return 'Required top-level folder structure is complete.';
    }

    return (
      'Add these folders at the top level before continuing: ' +
      missingRequiredFolders
        .map(function (label) { return label.replace(/\//g, ' or '); })
        .join(', ') +
      '.'
    );
  }

  function resolveTopLevelFolderChecklist(topLevelFolders) {
    var available = new Set(
      (Array.isArray(topLevelFolders) ? topLevelFolders : [])
        .map(normalizeFolderKey)
        .filter(Boolean)
    );

    return REQUIRED_TOP_LEVEL_FOLDER_GROUPS
      .concat(OPTIONAL_TOP_LEVEL_FOLDER_GROUPS)
      .map(function (group) {
        var aliasKeys = resolveAliasKeys(group.aliases);
        var present = aliasKeys.some(function (aliasKey) { return available.has(aliasKey); });
        return {
          id: group.id,
          label: group.label,
          required: REQUIRED_TOP_LEVEL_FOLDER_GROUPS.indexOf(group) !== -1,
          present: present,
        };
      });
  }

  function isKnownTopLevelFolder(folderName) {
    var normalized = normalizeFolderKey(folderName);
    if (!normalized) { return false; }

    var knownGroups = REQUIRED_TOP_LEVEL_FOLDER_GROUPS.concat(OPTIONAL_TOP_LEVEL_FOLDER_GROUPS);
    return knownGroups.some(function (group) {
      return resolveAliasKeys(group.aliases).indexOf(normalized) !== -1;
    });
  }

  return {
    REQUIRED_TOP_LEVEL_FOLDER_GROUPS: REQUIRED_TOP_LEVEL_FOLDER_GROUPS,
    OPTIONAL_TOP_LEVEL_FOLDER_GROUPS: OPTIONAL_TOP_LEVEL_FOLDER_GROUPS,
    REQUIRED_FOLDERS_PHASE1_COPY: REQUIRED_FOLDERS_PHASE1_COPY,
    normalizeFolderKey: normalizeFolderKey,
    resolveMissingRequiredTopLevelFolders: resolveMissingRequiredTopLevelFolders,
    buildStructureGateMessage: buildStructureGateMessage,
    buildMissingRequiredFolderGuidance: buildMissingRequiredFolderGuidance,
    resolveTopLevelFolderChecklist: resolveTopLevelFolderChecklist,
    isKnownTopLevelFolder: isKnownTopLevelFolder,
  };
});
