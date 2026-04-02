(function (global, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (global && typeof global === "object") {
    global.qcGuidanceCatalog = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var CATEGORY_ORDER = [
    "folder",
    "audio-zip",
    "samples",
    "demo",
    "description",
    "artwork",
    "presets",
    "midi",
  ];

  var CATEGORY_LABELS = {
    "folder": "Folder",
    "audio-zip": "Audio ZIP",
    "samples": "Samples",
    "demo": "Demo",
    "description": "Description",
    "artwork": "Artwork",
    "presets": "Presets",
    "midi": "MIDI",
  };

  var GUIDANCE_BY_RULE_ID = {
    FOLDER_AUDIO_MISSING: {
      category: "folder",
      title: "Missing Audio Folder",
      description: "Your pack must include a top-level Audio folder.",
      remediation: "Add an Audio folder at the root of the pack and place the ZIP inside it.",
    },
    FOLDER_ARTWORK_MISSING: {
      category: "folder",
      title: "Missing Artwork Folder",
      description: "Your pack must include Artwork or Cover Art.",
      remediation: "Add an Artwork (or Cover Art) folder at the root of the pack.",
    },
    FOLDER_DEMO_MISSING: {
      category: "folder",
      title: "Missing Demo Folder",
      description: "Your pack must include Demo or Demos.",
      remediation: "Add a Demo (or Demos) folder at the root of the pack.",
    },
    FOLDER_DESCRIPTION_MISSING: {
      category: "folder",
      title: "Missing Description Folder",
      description: "Your pack must include Description or Description & Info.",
      remediation: "Add a Description (or Description & Info) folder at the root of the pack.",
    },
    AUDIO_ZIP_FORMAT: {
      category: "audio-zip",
      title: "Audio ZIP Format",
      description: "Audio archive must be a .zip file.",
      remediation: "Re-export the audio archive as a .zip file and upload again.",
    },
    AUDIO_ZIP_LOCATION: {
      category: "audio-zip",
      title: "Audio ZIP Location",
      description: "Audio ZIP must be inside the Audio folder.",
      remediation: "Move the ZIP into the Audio folder and rerun QC.",
    },
    AUDIO_ZIP_NAMING: {
      category: "audio-zip",
      title: "Audio ZIP Naming",
      description: "ZIP name must match Label Name - Pack Name.zip.",
      remediation: "Rename to the required format and remove unsupported symbols.",
    },
    AUDIO_ZIP_UNSUPPORTED_CHARACTERS: {
      category: "audio-zip",
      title: "Unsupported ZIP Characters",
      description: "ZIP filename includes unsupported characters.",
      remediation: "Use letters, numbers, underscores, hyphens, and # only.",
    },
    AUDIO_ZIP_SIZE_TOO_SMALL: {
      category: "audio-zip",
      title: "Audio ZIP Too Small",
      description: "Audio ZIP must be larger than 100 KB.",
      remediation: "Your audio ZIP must be over 100 KB. Current: {size}.",
    },
    AUDIO_ZIP_SIZE_TOO_LARGE: {
      category: "audio-zip",
      title: "Audio ZIP Too Large",
      description: "Audio ZIP must be under 4 GB.",
      remediation: "Your audio ZIP must be under 4 GB. Current: {size}.",
    },
    SAMPLE_TOP_FOLDER_NAMING: {
      category: "samples",
      title: "Sample Root Folder Name",
      description: "Extracted top folder must be Label Name - Pack Name.",
      remediation: "Rename the extracted sample root folder to the required format.",
    },
    SAMPLE_SUBFOLDER_ONESHOTS_MISSING: {
      category: "samples",
      title: "Missing One Shots Folder",
      description: "Sample root must include One_Shots.",
      remediation: "Add One_Shots (or accepted variation) to the sample root.",
    },
    SAMPLE_SUBFOLDER_LOOPS_MISSING: {
      category: "samples",
      title: "Missing Loops Folder",
      description: "Sample root must include Loops.",
      remediation: "Add Loops (or accepted variation) to the sample root.",
    },
    SAMPLE_COUNT_EXCEEDED: {
      category: "samples",
      title: "Too Many Samples",
      description: "A pack can contain up to 1000 samples.",
      remediation: "Reduce sample count to 1000 or fewer. Current: {count}.",
    },
    SAMPLE_DURATION_EXCEEDED: {
      category: "samples",
      title: "Sample Too Long",
      description: "Each sample must be 3 minutes or shorter.",
      remediation: "Trim long samples to 3:00 or less. File: {file_ref}.",
    },
    SAMPLE_RATE_TOO_LOW: {
      category: "samples",
      title: "Sample Rate Too Low",
      description: "Samples must be at least 44.1 kHz.",
      remediation: "Resample files to 44.1 kHz or higher. File: {file_ref}.",
    },
    SAMPLE_RATE_INCONSISTENT: {
      category: "samples",
      title: "Inconsistent Sample Rates",
      description: "All sample files must use the same sample rate.",
      remediation: "Use one sample rate across all samples before re-zipping.",
    },
    SAMPLE_BIT_DEPTH_INVALID: {
      category: "samples",
      title: "Invalid Bit Depth",
      description: "Only 16-bit or 24-bit WAV files are supported.",
      remediation: "Convert unsupported bit depth files to 16-bit or 24-bit WAV.",
    },
    SAMPLE_NORMALIZATION_OUT_OF_RANGE: {
      category: "samples",
      title: "Sample Normalization Warning",
      description: "Peak should be between -15 dB and 0 dB.",
      remediation: "Adjust gain/limiting so sample peaks are in range. File: {file_ref}.",
    },
    SAMPLE_FORMAT_INVALID: {
      category: "samples",
      title: "Invalid Sample Format",
      description: "Sample assets must be WAV files.",
      remediation: "Convert non-WAV files to WAV and rerun QC.",
    },
    SAMPLE_DUPLICATE_FOUND: {
      category: "samples",
      title: "Duplicate Samples Found",
      description: "Identical samples were detected in this pack.",
      remediation: "Remove duplicate files or replace with unique samples.",
    },
    SAMPLE_CORRUPT_FILE: {
      category: "samples",
      title: "Corrupt Sample",
      description: "Corrupt or extremely small sample file detected.",
      remediation: "Replace broken files and ensure each file is valid audio.",
    },
    SAMPLE_FILENAME_UNSUPPORTED_CHARACTERS: {
      category: "samples",
      title: "Unsupported Filename Characters",
      description: "Sample names include unsupported characters.",
      remediation: "Rename files using supported characters only.",
    },
    SAMPLE_FILENAME_BANNED_TERM: {
      category: "samples",
      title: "Banned Term In Filename",
      description: "Sample names contain disallowed terms.",
      remediation: "Rename files to remove terms like rhodes, tribal, oriental, urban.",
    },
    SAMPLE_FILENAME_FRACTIONAL_BPM: {
      category: "samples",
      title: "Fractional BPM In Filename",
      description: "Fractional BPM values are not allowed in sample names.",
      remediation: "Rename files to whole BPM values only (for example 72 BPM).",
    },
    DEMO_LOCATION_INVALID: {
      category: "demo",
      title: "Demo Location",
      description: "Demo must be inside Demo or Demos folder.",
      remediation: "Move demo MP3 into the Demo/Demos folder.",
    },
    DEMO_FORMAT_INVALID: {
      category: "demo",
      title: "Demo Format",
      description: "Demo file must be MP3.",
      remediation: "Convert the demo to MP3 before submission.",
    },
    DEMO_BITRATE_INVALID: {
      category: "demo",
      title: "Demo Bitrate",
      description: "Demo bitrate must be 320 kbps.",
      remediation: "Re-export the demo at 320 kbps.",
    },
    DEMO_SIZE_EXCEEDED: {
      category: "demo",
      title: "Demo Too Large",
      description: "Demo must be 10 MB or smaller.",
      remediation: "Re-export/compress the demo under 10 MB. Current: {size}.",
    },
    DEMO_DURATION_EXCEEDED: {
      category: "demo",
      title: "Demo Too Long",
      description: "Demo must be 3 minutes 30 seconds or shorter.",
      remediation: "Trim the demo to 3:30 or less.",
    },
    DEMO_NORMALIZATION_INVALID: {
      category: "demo",
      title: "Demo Normalization",
      description: "Demo peak must be -1.0 dB.",
      remediation: "Adjust the demo output peak to -1.0 dB.",
    },
    DESCRIPTION_LOCATION_INVALID: {
      category: "description",
      title: "Description Location",
      description: "Description file must be in Description folder.",
      remediation: "Move the description file into Description or Description & Info.",
    },
    DESCRIPTION_FORMAT_INVALID: {
      category: "description",
      title: "Description Format",
      description: "Description file must be .txt or .rtf.",
      remediation: "Save the description as .txt or .rtf.",
    },
    DESCRIPTION_BANNED_TERM: {
      category: "description",
      title: "Banned Term In Description",
      description: "Description contains unsupported or inappropriate terms.",
      remediation: "Edit the description to remove disallowed terms.",
    },
    ART_LOCATION_INVALID: {
      category: "artwork",
      title: "Artwork Location",
      description: "Artwork must be in Artwork or Cover Art folder.",
      remediation: "Move artwork into Artwork/Cover Art folder.",
    },
    ART_FORMAT_INVALID: {
      category: "artwork",
      title: "Artwork Format",
      description: "Artwork must be JPG or PNG.",
      remediation: "Export artwork as JPG or PNG.",
    },
    ART_SIZE_EXCEEDED: {
      category: "artwork",
      title: "Artwork Too Large",
      description: "Artwork must be 10 MB or smaller.",
      remediation: "Compress artwork under 10 MB. Current: {size}.",
    },
    ART_RESOLUTION_OUT_OF_RANGE: {
      category: "artwork",
      title: "Artwork Resolution",
      description: "Artwork must be between 600 px and 2000 px.",
      remediation: "Resize artwork to the allowed range.",
    },
    ART_ASPECT_RATIO_NOT_SQUARE: {
      category: "artwork",
      title: "Artwork Aspect Ratio",
      description: "Artwork must have a 1:1 square aspect ratio.",
      remediation: "Crop or resize artwork to square dimensions.",
    },
    PRESET_FILE_TYPE_INVALID: {
      category: "presets",
      title: "Unsupported Preset Type",
      description: "Preset type is not in the approved list.",
      remediation: "Use only approved preset formats for this submission.",
    },
    PRESET_FILE_SIZE_OUT_OF_RANGE: {
      category: "presets",
      title: "Preset Size Out Of Range",
      description: "Preset files must be between 100 B and 50 MB.",
      remediation: "Resize/re-export preset file to fit the allowed size range.",
    },
    PRESET_FILENAME_INVALID: {
      category: "presets",
      title: "Invalid Preset Filename",
      description: "Preset filename does not meet naming policy.",
      remediation: "Rename preset files to remove unsupported terms/characters.",
    },
    PRESET_PREVIEW_MISSING: {
      category: "presets",
      title: "Missing Preset Preview",
      description: "Each preset requires a matching MP3 preview.",
      remediation: "Add a same-name MP3 preview for every preset file.",
    },
    PRESET_PREVIEW_FORMAT_INVALID: {
      category: "presets",
      title: "Invalid Preset Preview Format",
      description: "Preset preview must be MP3.",
      remediation: "Convert preset preview files to MP3.",
    },
    PRESET_PREVIEW_SIZE_EXCEEDED: {
      category: "presets",
      title: "Preset Preview Too Large",
      description: "Preset preview must be 5 MB or smaller.",
      remediation: "Compress preset preview under 5 MB.",
    },
    PRESET_PREVIEW_DURATION_EXCEEDED: {
      category: "presets",
      title: "Preset Preview Too Long",
      description: "Preset preview must be 1 minute or shorter.",
      remediation: "Trim preset preview to 1:00 or less.",
    },
    PRESET_PREVIEW_NORMALIZATION_INVALID: {
      category: "presets",
      title: "Preset Preview Normalization",
      description: "Preset preview peak must be -1.0 dB.",
      remediation: "Normalize preset preview to -1.0 dB peak.",
    },
    PRESET_PREVIEW_BITRATE_INVALID: {
      category: "presets",
      title: "Preset Preview Bitrate",
      description: "Preset preview bitrate must be 320 kbps.",
      remediation: "Re-export preset preview at 320 kbps.",
    },
    MIDI_FORMAT_INVALID: {
      category: "midi",
      title: "Invalid MIDI Format",
      description: "MIDI assets must be .mid files.",
      remediation: "Convert MIDI assets to .mid format.",
    },
    MIDI_TYPE_INVALID: {
      category: "midi",
      title: "MIDI Type Not Supported",
      description: "MIDI files must be Type 0.",
      remediation: "Re-export MIDI as Type 0.",
    },
    MIDI_PREVIEW_MISSING: {
      category: "midi",
      title: "Missing MIDI Preview",
      description: "Each MIDI file requires a same-name MP3 preview.",
      remediation: "Add matching MP3 previews for all MIDI files.",
    },
    MIDI_PREVIEW_FORMAT_INVALID: {
      category: "midi",
      title: "Invalid MIDI Preview Format",
      description: "MIDI preview must be MP3.",
      remediation: "Convert MIDI previews to MP3.",
    },
    MIDI_PREVIEW_SIZE_EXCEEDED: {
      category: "midi",
      title: "MIDI Preview Too Large",
      description: "MIDI preview must be 5 MB or smaller.",
      remediation: "Compress MIDI preview under 5 MB.",
    },
    MIDI_PREVIEW_DURATION_EXCEEDED: {
      category: "midi",
      title: "MIDI Preview Too Long",
      description: "MIDI preview must be 1 minute or shorter.",
      remediation: "Trim MIDI preview to 1:00 or less.",
    },
    MIDI_PREVIEW_NORMALIZATION_INVALID: {
      category: "midi",
      title: "MIDI Preview Normalization",
      description: "MIDI preview peak must be -1.0 dB.",
      remediation: "Normalize MIDI preview to -1.0 dB peak.",
    },
    MIDI_PREVIEW_BITRATE_INVALID: {
      category: "midi",
      title: "MIDI Preview Bitrate",
      description: "MIDI preview bitrate must be 320 kbps.",
      remediation: "Re-export MIDI preview at 320 kbps.",
    },

    "PACK.FOLDER.AUDIO.REQUIRED": {
      category: "folder",
      title: "Missing Audio Folder",
      description: "Audio folder is missing from top-level pack structure.",
      remediation: "Add the Audio folder at the top level of your pack.",
    },
    "PACK.AUDIO.ZIP.NAMING": {
      category: "audio-zip",
      title: "Audio ZIP Naming",
      description: "Audio ZIP filename does not follow the required format.",
      remediation: "Rename ZIP to Label Name - Pack Name.zip.",
    },
    "PACK.AUDIO.ZIP.SIZE": {
      category: "audio-zip",
      title: "Audio ZIP Size",
      description: "Audio ZIP is outside the allowed size range.",
      remediation: "Keep ZIP size between 100 KB and 4 GB.",
    },
    "PACK.SAMPLE-COUNT.MAX": {
      category: "samples",
      title: "Sample Count",
      description: "Sample count exceeds allowed maximum.",
      remediation: "Reduce total sample count to 1000 or fewer.",
    },
    "PACK.NAMING.UNSUPPORTED-TOKENS": {
      category: "samples",
      title: "Unsupported Naming Tokens",
      description: "Pack includes unsupported naming tokens.",
      remediation: "Rename offending files/folders to match naming policy.",
    },
  };

  var RULE_ALIASES = {
    "pack.folder.audio.required": "PACK.FOLDER.AUDIO.REQUIRED",
    "pack.audio.zip.naming": "PACK.AUDIO.ZIP.NAMING",
    "pack.audio.zip.size": "PACK.AUDIO.ZIP.SIZE",
    "pack.sample-count.max": "PACK.SAMPLE-COUNT.MAX",
    "pack.naming.unsupported-tokens": "PACK.NAMING.UNSUPPORTED-TOKENS",
  };

  function normalizeRuleId(ruleId) {
    var raw = String(ruleId || "").trim();
    if (!raw) {
      return "";
    }
    if (Object.prototype.hasOwnProperty.call(RULE_ALIASES, raw)) {
      return RULE_ALIASES[raw];
    }
    return raw.toUpperCase();
  }

  function formatTemplate(template, values) {
    if (typeof template !== "string") {
      return "";
    }
    return template.replace(/\{([^}]+)\}/g, function (_, key) {
      var value = values && values[key];
      return value == null ? "—" : String(value);
    });
  }

  function fallbackCategory(ruleId) {
    var normalized = normalizeRuleId(ruleId);
    if (normalized.indexOf("AUDIO_ZIP") !== -1) {
      return "audio-zip";
    }
    if (normalized.indexOf("SAMPLE") !== -1 || normalized.indexOf("PACK.SAMPLE") === 0) {
      return "samples";
    }
    if (normalized.indexOf("DEMO") !== -1) {
      return "demo";
    }
    if (normalized.indexOf("DESCRIPTION") !== -1) {
      return "description";
    }
    if (normalized.indexOf("ART") === 0 || normalized.indexOf("ARTWORK") !== -1) {
      return "artwork";
    }
    if (normalized.indexOf("PRESET") !== -1) {
      return "presets";
    }
    if (normalized.indexOf("MIDI") !== -1) {
      return "midi";
    }
    return "folder";
  }

  function resolveGuidance(ruleId) {
    var normalized = normalizeRuleId(ruleId);
    if (Object.prototype.hasOwnProperty.call(GUIDANCE_BY_RULE_ID, normalized)) {
      return GUIDANCE_BY_RULE_ID[normalized];
    }
    return {
      category: fallbackCategory(normalized),
      title: normalized || "Unknown QC Rule",
      description: "This QC finding requires review.",
      remediation: "Review the file and fix the issue, then rerun QC.",
    };
  }

  function resolveCategory(ruleId) {
    return resolveGuidance(ruleId).category;
  }

  return {
    CATEGORY_ORDER: CATEGORY_ORDER,
    CATEGORY_LABELS: CATEGORY_LABELS,
    GUIDANCE_BY_RULE_ID: GUIDANCE_BY_RULE_ID,
    normalizeRuleId: normalizeRuleId,
    formatTemplate: formatTemplate,
    resolveGuidance: resolveGuidance,
    resolveCategory: resolveCategory,
  };
});
