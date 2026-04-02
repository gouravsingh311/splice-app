#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  FLOWS,
  OUTPUT_DIRS,
  flowSlug,
  masterVideoName,
  finalVideoName,
} = require('./shot-list');

const variant = String(process.argv[2] || '').toLowerCase();
if (!['silent', 'voiceover'].includes(variant)) {
  console.error('Usage: node scripts/demo-media/render-videos.js <silent|voiceover>');
  process.exit(1);
}

ensureDirs();
const variantRoot = path.join(OUTPUT_DIRS.mediaRoot, 'videos');

const manifest = [];
for (const flow of FLOWS) {
  const inputVideo = path.join(OUTPUT_DIRS.masters, masterVideoName(flow));
  if (!fs.existsSync(inputVideo)) {
    createMasterFromScreenshots(flow, inputVideo);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-media-'));
  const subtitlesFile = path.join(tmpDir, `${flowSlug(flow)}.srt`);
  writeSubtitles(subtitlesFile, flow.steps);

  const outputDir = variant === 'silent' ? OUTPUT_DIRS.silentVideos : OUTPUT_DIRS.voiceoverVideos;
  const outputFile = path.join(
    outputDir,
    finalVideoName(flow, variant === 'silent' ? 'silent-cc' : 'voice-cc'),
  );

  if (variant === 'silent') {
    renderSilent({ inputVideo, subtitlesFile, outputFile });
  } else {
    const narrationWav = resolveNarrationWav(flow, tmpDir);
    renderVoiceover({ inputVideo, subtitlesFile, narrationWav, outputFile });
  }

  manifest.push({
    role: flow.role,
    flow: flow.flow,
    variant: variant === 'silent' ? 'silent-cc' : 'voice-cc',
    outputFile,
  });
}

const manifestOut = path.join(
  variantRoot,
  variant,
  `manifest-${variant}.json`,
);
fs.writeFileSync(manifestOut, JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2));
console.log(`Generated ${manifest.length} ${variant} videos.`);

function ensureDirs() {
  fs.mkdirSync(OUTPUT_DIRS.silentVideos, { recursive: true });
  fs.mkdirSync(OUTPUT_DIRS.voiceoverVideos, { recursive: true });
  fs.mkdirSync(path.join(OUTPUT_DIRS.mediaRoot, 'videos', 'masters'), { recursive: true });
}

function writeSubtitles(subtitlesFile, steps) {
  let cursorMs = 0;
  const lines = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const holdMs = Number(step.holdMs || 2400);
    const start = cursorMs;
    const end = cursorMs + holdMs;
    cursorMs = end;

    lines.push(String(i + 1));
    lines.push(`${toSrtTime(start)} --> ${toSrtTime(end)}`);
    lines.push(step.caption);
    lines.push('');
  }

  fs.writeFileSync(subtitlesFile, `${lines.join('\n')}\n`, 'utf8');
}

function resolveNarrationWav(flow, tmpDir) {
  const narrationDir = process.env.DEMO_MEDIA_NARRATION_DIR
    ? path.resolve(process.env.DEMO_MEDIA_NARRATION_DIR)
    : path.join(OUTPUT_DIRS.mediaRoot, 'narration');

  const preferred = path.join(narrationDir, `${flowSlug(flow)}.wav`);
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  fs.mkdirSync(narrationDir, { recursive: true });

  const aiffOut = path.join(tmpDir, `${flowSlug(flow)}.aiff`);
  const wavOut = path.join(narrationDir, `${flowSlug(flow)}.wav`);

  try {
    execFileSync('say', ['-r', '175', '-o', aiffOut, flow.narrationText], { stdio: 'pipe' });
    execFileSync('ffmpeg', ['-y', '-i', aiffOut, '-ar', '48000', '-ac', '1', wavOut], { stdio: 'pipe' });
    return wavOut;
  } catch (error) {
    console.error(
      `Unable to synthesize narration for ${flowSlug(flow)}. Provide ${preferred} or ensure macOS 'say' and ffmpeg are available.`,
    );
    throw error;
  }
}

function createMasterFromScreenshots(flow, outputFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-master-'));
  const concatFile = path.join(tmpDir, `${flowSlug(flow)}-concat.txt`);
  const lines = [];

  for (const step of flow.steps) {
    const shotPath = path.join(OUTPUT_DIRS.screenshots, `${flow.role}-${flow.flow}-${step.id}.png`);
    if (!fs.existsSync(shotPath)) {
      throw new Error(`Missing screenshot for ${flowSlug(flow)} step ${step.id}: ${shotPath}`);
    }
    const holdSeconds = Math.max(0.4, Number(step.holdMs || 2400) / 1000);
    lines.push(`file '${escapeConcatPath(shotPath)}'`);
    lines.push(`duration ${holdSeconds.toFixed(3)}`);
  }

  const lastStep = flow.steps[flow.steps.length - 1];
  const lastShot = path.join(OUTPUT_DIRS.screenshots, `${flow.role}-${flow.flow}-${lastStep.id}.png`);
  lines.push(`file '${escapeConcatPath(lastShot)}'`);
  fs.writeFileSync(concatFile, `${lines.join('\n')}\n`, 'utf8');

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatFile,
      '-vf',
      'fps=30,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      outputFile,
    ],
    { stdio: 'pipe' },
  );
}

function renderSilent({ inputVideo, subtitlesFile, outputFile }) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputVideo,
      '-f',
      'srt',
      '-i',
      subtitlesFile,
      '-an',
      '-map',
      '0:v:0',
      '-map',
      '1:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:s',
      'mov_text',
      outputFile,
    ],
    { stdio: 'pipe' },
  );
}

function renderVoiceover({ inputVideo, subtitlesFile, narrationWav, outputFile }) {
  const duration = getDurationSeconds(inputVideo);

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputVideo,
      '-i',
      narrationWav,
      '-f',
      'srt',
      '-i',
      subtitlesFile,
      '-filter:a',
      'apad',
      '-t',
      String(duration),
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-map',
      '2:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-c:s',
      'mov_text',
      outputFile,
    ],
    { stdio: 'pipe' },
  );
}

function getDurationSeconds(inputFile) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputFile,
    ],
    { encoding: 'utf8' },
  ).trim();

  const parsed = Number(out);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Unable to resolve video duration for ${inputFile}`);
  }

  return parsed;
}

function toSrtTime(totalMs) {
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = Math.floor(totalMs % 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${padMs(ms)}`;
}

function escapeConcatPath(filePath) {
  return filePath.replace(/'/g, "'\\''");
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function padMs(value) {
  return String(value).padStart(3, '0');
}
