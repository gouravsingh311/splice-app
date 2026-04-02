export type QcGuidance = {
  title: string;
  description: string;
  remediation: string;
  category:
    | "folder"
    | "audio-zip"
    | "samples"
    | "demo"
    | "description"
    | "artwork"
    | "presets"
    | "midi";
};

export const CATEGORY_ORDER = [
  "folder",
  "audio-zip",
  "samples",
  "demo",
  "description",
  "artwork",
  "presets",
  "midi",
] as const;

export const guidanceCatalog: Record<string, QcGuidance> = {
  FOLDER_AUDIO_MISSING: { title: "Missing Audio Folder", description: "Top-level Audio folder is required.", remediation: "Add Audio at pack root.", category: "folder" },
  FOLDER_ARTWORK_MISSING: { title: "Missing Artwork Folder", description: "Artwork/Cover Art folder is required.", remediation: "Add Artwork or Cover Art at pack root.", category: "folder" },
  FOLDER_DEMO_MISSING: { title: "Missing Demo Folder", description: "Demo/Demos folder is required.", remediation: "Add Demo or Demos at pack root.", category: "folder" },
  FOLDER_DESCRIPTION_MISSING: { title: "Missing Description Folder", description: "Description folder is required.", remediation: "Add Description or Description & Info at pack root.", category: "folder" },

  AUDIO_ZIP_FORMAT: { title: "Audio ZIP Format", description: "Audio archive must be .zip.", remediation: "Re-export as .zip.", category: "audio-zip" },
  AUDIO_ZIP_LOCATION: { title: "Audio ZIP Location", description: "Audio ZIP must be inside Audio folder.", remediation: "Move ZIP into Audio folder.", category: "audio-zip" },
  AUDIO_ZIP_NAMING: { title: "Audio ZIP Naming", description: "Filename must match Label Name - Pack Name.zip.", remediation: "Rename ZIP to the required format.", category: "audio-zip" },
  AUDIO_ZIP_UNSUPPORTED_CHARACTERS: { title: "Unsupported ZIP Characters", description: "ZIP filename has unsupported characters.", remediation: "Use supported characters only.", category: "audio-zip" },
  AUDIO_ZIP_SIZE_TOO_SMALL: { title: "Audio ZIP Too Small", description: "Audio ZIP must be above 100 KB.", remediation: "Your audio ZIP must be over 100 KB. Current: {size}.", category: "audio-zip" },
  AUDIO_ZIP_SIZE_TOO_LARGE: { title: "Audio ZIP Too Large", description: "Audio ZIP must be under 4 GB.", remediation: "Your audio ZIP must be under 4 GB. Current: {size}.", category: "audio-zip" },

  SAMPLE_TOP_FOLDER_NAMING: { title: "Sample Root Folder Name", description: "Extracted folder must match Label Name - Pack Name.", remediation: "Rename extracted root folder.", category: "samples" },
  SAMPLE_SUBFOLDER_ONESHOTS_MISSING: { title: "One Shots Missing", description: "One_Shots folder is required.", remediation: "Add One_Shots (or accepted variation).", category: "samples" },
  SAMPLE_SUBFOLDER_LOOPS_MISSING: { title: "Loops Missing", description: "Loops folder is required.", remediation: "Add Loops (or accepted variation).", category: "samples" },
  SAMPLE_COUNT_EXCEEDED: { title: "Too Many Samples", description: "Maximum sample count is 1000.", remediation: "Reduce sample count. Current: {count}.", category: "samples" },
  SAMPLE_DURATION_EXCEEDED: { title: "Sample Too Long", description: "Each sample must be <= 3:00.", remediation: "Trim long samples.", category: "samples" },
  SAMPLE_RATE_TOO_LOW: { title: "Sample Rate Too Low", description: "Minimum sample rate is 44.1 kHz.", remediation: "Resample to >= 44.1 kHz.", category: "samples" },
  SAMPLE_RATE_INCONSISTENT: { title: "Inconsistent Sample Rates", description: "All samples must use one sample rate.", remediation: "Use one sample rate across files.", category: "samples" },
  SAMPLE_BIT_DEPTH_INVALID: { title: "Invalid Bit Depth", description: "Only 16-bit or 24-bit WAV is supported.", remediation: "Convert unsupported files to 16/24-bit WAV.", category: "samples" },
  SAMPLE_NORMALIZATION_OUT_OF_RANGE: { title: "Normalization Warning", description: "Peak should be between -15 dB and 0 dB.", remediation: "Adjust gain to target range.", category: "samples" },
  SAMPLE_FORMAT_INVALID: { title: "Invalid Sample Format", description: "Samples must be WAV.", remediation: "Convert non-WAV files to WAV.", category: "samples" },
  SAMPLE_DUPLICATE_FOUND: { title: "Duplicate Samples", description: "Duplicate sample content detected.", remediation: "Remove or replace duplicates.", category: "samples" },
  SAMPLE_CORRUPT_FILE: { title: "Corrupt Sample", description: "Broken or tiny sample file detected.", remediation: "Replace corrupt sample files.", category: "samples" },
  SAMPLE_FILENAME_UNSUPPORTED_CHARACTERS: { title: "Unsupported Filename Characters", description: "Sample names contain unsupported characters.", remediation: "Rename samples using supported characters.", category: "samples" },
  SAMPLE_FILENAME_BANNED_TERM: { title: "Banned Term In Filename", description: "Sample name contains disallowed term.", remediation: "Rename file to remove banned terms.", category: "samples" },
  SAMPLE_FILENAME_FRACTIONAL_BPM: { title: "Fractional BPM In Filename", description: "Fractional BPM values are not allowed.", remediation: "Use whole BPM in filename.", category: "samples" },

  DEMO_LOCATION_INVALID: { title: "Demo Location", description: "Demo must be inside Demo/Demos.", remediation: "Move demo to Demo/Demos.", category: "demo" },
  DEMO_FORMAT_INVALID: { title: "Demo Format", description: "Demo must be MP3.", remediation: "Convert demo to MP3.", category: "demo" },
  DEMO_BITRATE_INVALID: { title: "Demo Bitrate", description: "Demo bitrate must be 320 kbps.", remediation: "Re-export at 320 kbps.", category: "demo" },
  DEMO_SIZE_EXCEEDED: { title: "Demo Too Large", description: "Demo must be <= 10 MB.", remediation: "Compress demo under 10 MB.", category: "demo" },
  DEMO_DURATION_EXCEEDED: { title: "Demo Too Long", description: "Demo must be <= 3:30.", remediation: "Trim demo to 3:30 or less.", category: "demo" },
  DEMO_NORMALIZATION_INVALID: { title: "Demo Normalization", description: "Demo peak must be -1.0 dB.", remediation: "Normalize demo to -1.0 dB.", category: "demo" },

  DESCRIPTION_LOCATION_INVALID: { title: "Description Location", description: "Description file is in wrong folder.", remediation: "Move description into Description folder.", category: "description" },
  DESCRIPTION_FORMAT_INVALID: { title: "Description Format", description: "Description must be .txt or .rtf.", remediation: "Export description as .txt/.rtf.", category: "description" },
  DESCRIPTION_BANNED_TERM: { title: "Banned Term In Description", description: "Description contains disallowed terms.", remediation: "Remove unsupported terms from description.", category: "description" },

  ART_LOCATION_INVALID: { title: "Artwork Location", description: "Artwork must be in Artwork/Cover Art.", remediation: "Move artwork to correct folder.", category: "artwork" },
  ART_FORMAT_INVALID: { title: "Artwork Format", description: "Artwork must be JPG or PNG.", remediation: "Export artwork as JPG/PNG.", category: "artwork" },
  ART_SIZE_EXCEEDED: { title: "Artwork Too Large", description: "Artwork must be <= 10 MB.", remediation: "Compress artwork under 10 MB.", category: "artwork" },
  ART_RESOLUTION_OUT_OF_RANGE: { title: "Artwork Resolution", description: "Artwork must be 600-2000 px.", remediation: "Resize artwork to allowed range.", category: "artwork" },
  ART_ASPECT_RATIO_NOT_SQUARE: { title: "Artwork Aspect Ratio", description: "Artwork must be square (1:1).", remediation: "Crop artwork to 1:1 ratio.", category: "artwork" },

  PRESET_FILE_TYPE_INVALID: { title: "Preset Type", description: "Preset file type is not allowed.", remediation: "Use supported preset file extensions.", category: "presets" },
  PRESET_FILE_SIZE_OUT_OF_RANGE: { title: "Preset Size", description: "Preset file must be 100 B - 50 MB.", remediation: "Re-export preset file to allowed size.", category: "presets" },
  PRESET_FILENAME_INVALID: { title: "Preset Filename", description: "Preset filename violates naming rules.", remediation: "Rename preset files to comply.", category: "presets" },
  PRESET_PREVIEW_MISSING: { title: "Preset Preview Missing", description: "Preset requires matching MP3 preview.", remediation: "Add same-name MP3 preview for each preset.", category: "presets" },
  PRESET_PREVIEW_FORMAT_INVALID: { title: "Preset Preview Format", description: "Preset preview must be MP3.", remediation: "Convert preset preview to MP3.", category: "presets" },
  PRESET_PREVIEW_SIZE_EXCEEDED: { title: "Preset Preview Too Large", description: "Preset preview must be <= 5 MB.", remediation: "Compress preset preview.", category: "presets" },
  PRESET_PREVIEW_DURATION_EXCEEDED: { title: "Preset Preview Too Long", description: "Preset preview must be <= 1:00.", remediation: "Trim preset preview.", category: "presets" },
  PRESET_PREVIEW_NORMALIZATION_INVALID: { title: "Preset Preview Normalization", description: "Preset preview peak must be -1.0 dB.", remediation: "Normalize preset preview to -1.0 dB.", category: "presets" },
  PRESET_PREVIEW_BITRATE_INVALID: { title: "Preset Preview Bitrate", description: "Preset preview must be 320 kbps.", remediation: "Re-export preview at 320 kbps.", category: "presets" },

  MIDI_FORMAT_INVALID: { title: "MIDI Format", description: "MIDI files must use .mid.", remediation: "Convert MIDI files to .mid.", category: "midi" },
  MIDI_TYPE_INVALID: { title: "MIDI Type", description: "MIDI file must be Type 0.", remediation: "Re-export MIDI as Type 0.", category: "midi" },
  MIDI_PREVIEW_MISSING: { title: "MIDI Preview Missing", description: "Each MIDI needs matching MP3 preview.", remediation: "Add same-name MP3 for each MIDI file.", category: "midi" },
  MIDI_PREVIEW_FORMAT_INVALID: { title: "MIDI Preview Format", description: "MIDI preview must be MP3.", remediation: "Convert MIDI preview to MP3.", category: "midi" },
  MIDI_PREVIEW_SIZE_EXCEEDED: { title: "MIDI Preview Too Large", description: "MIDI preview must be <= 5 MB.", remediation: "Compress MIDI preview.", category: "midi" },
  MIDI_PREVIEW_DURATION_EXCEEDED: { title: "MIDI Preview Too Long", description: "MIDI preview must be <= 1:00.", remediation: "Trim MIDI preview.", category: "midi" },
  MIDI_PREVIEW_NORMALIZATION_INVALID: { title: "MIDI Preview Normalization", description: "MIDI preview peak must be -1.0 dB.", remediation: "Normalize MIDI preview to -1.0 dB.", category: "midi" },
  MIDI_PREVIEW_BITRATE_INVALID: { title: "MIDI Preview Bitrate", description: "MIDI preview must be 320 kbps.", remediation: "Re-export MIDI preview at 320 kbps.", category: "midi" },

  "PACK.FOLDER.AUDIO.REQUIRED": { title: "Missing Audio Folder", description: "Audio folder is required.", remediation: "Add top-level Audio folder.", category: "folder" },
  "PACK.AUDIO.ZIP.NAMING": { title: "Audio ZIP Naming", description: "ZIP name format is invalid.", remediation: "Rename ZIP to Label Name - Pack Name.zip.", category: "audio-zip" },
  "PACK.AUDIO.ZIP.SIZE": { title: "Audio ZIP Size", description: "ZIP size is outside allowed range.", remediation: "Keep ZIP between 100 KB and 4 GB.", category: "audio-zip" },
  "PACK.SAMPLE-COUNT.MAX": { title: "Sample Count", description: "Sample count exceeds max limit.", remediation: "Reduce sample count to 1000 or fewer.", category: "samples" },
  "PACK.NAMING.UNSUPPORTED-TOKENS": { title: "Unsupported Naming Tokens", description: "Unsupported naming terms detected.", remediation: "Rename files/folders to remove unsupported tokens.", category: "samples" },
};
