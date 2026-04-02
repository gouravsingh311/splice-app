#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_DIR = path.join(ROOT, 'docs', 'reports', 'assets', 'e2e-visual-baseline', 'baseline');
const CURRENT_DIR = path.join(ROOT, 'docs', 'reports', 'assets', 'e2e-visual-baseline', 'current');
const DIFF_DIR = path.join(ROOT, 'docs', 'reports', 'assets', 'e2e-visual-baseline', 'diff');
const REPORT_PATH = path.join(ROOT, 'docs', 'reports', 'E2E-visual-baseline-diff.md');
const PIXELMATCH_THRESHOLD = 0.12;
const THRESHOLD_PCT = Number(process.env.VISUAL_DIFF_THRESHOLD_PCT || '0.75');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toRelative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function formatSize(image) {
  return `${image.width}x${image.height}`;
}

function createComparisonCanvas(image, width, height) {
  const canvas = new PNG({ width, height });
  canvas.data.fill(0);
  PNG.bitblt(image, canvas, 0, 0, image.width, image.height, 0, 0);
  return canvas;
}

function comparePngs(pixelmatch, baselinePath, currentPath, diffPath) {
  const baseline = readPng(baselinePath);
  const current = readPng(currentPath);
  const width = Math.max(baseline.width, current.width);
  const height = Math.max(baseline.height, current.height);
  const comparedPixels = width * height;

  if (comparedPixels === 0) {
    return {
      baseline,
      current,
      diffPixels: 0,
      mismatchPct: 0,
      comparedSize: `${width}x${height}`,
    };
  }

  const baselineCanvas = createComparisonCanvas(baseline, width, height);
  const currentCanvas = createComparisonCanvas(current, width, height);
  const diff = new PNG({ width, height });
  diff.data.fill(0);
  const diffPixels = pixelmatch(
    baselineCanvas.data,
    currentCanvas.data,
    diff.data,
    width,
    height,
    {
      threshold: PIXELMATCH_THRESHOLD,
      includeAA: false,
    },
  );

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  return {
    baseline,
    current,
    diffPixels,
    mismatchPct: (diffPixels / comparedPixels) * 100,
    comparedSize: `${width}x${height}`,
  };
}

async function run() {
  const pixelmatchModule = await import('pixelmatch');
  const pixelmatch = pixelmatchModule.default;
  ensureDir(DIFF_DIR);

  const currentShots = fs.existsSync(CURRENT_DIR)
    ? fs.readdirSync(CURRENT_DIR).filter((name) => name.endsWith('.png')).sort()
    : [];

  if (!currentShots.length) {
    throw new Error(`No current screenshots found at ${CURRENT_DIR}. Run visual:baseline:capture first.`);
  }

  const rows = [];
  let hasFailure = false;

  for (const fileName of currentShots) {
    const currentPath = path.join(CURRENT_DIR, fileName);
    const baselinePath = path.join(BASELINE_DIR, fileName);
    const diffPath = path.join(DIFF_DIR, fileName);

    if (!fs.existsSync(baselinePath)) {
      rows.push({
        page: fileName.replace(/\.png$/, ''),
        mismatch: null,
        verdict: 'MISSING_BASELINE',
        diff: '—',
        notes: `Missing baseline: ${toRelative(baselinePath)}`,
      });
      hasFailure = true;
      continue;
    }

    const comparison = comparePngs(pixelmatch, baselinePath, currentPath, diffPath);
    const mismatchPct = comparison.mismatchPct;
    if (mismatchPct === 0 && fs.existsSync(diffPath)) {
      fs.unlinkSync(diffPath);
    }
    const verdict = mismatchPct <= THRESHOLD_PCT ? 'PASS' : 'FAIL';
    if (verdict === 'FAIL') {
      hasFailure = true;
    }

    rows.push({
      page: fileName.replace(/\.png$/, ''),
      mismatch: mismatchPct,
      diffPixels: comparison.diffPixels,
      baselineSize: formatSize(comparison.baseline),
      currentSize: formatSize(comparison.current),
      comparedSize: comparison.comparedSize,
      verdict,
      diff: mismatchPct > 0 ? `[${fileName}](${toRelative(diffPath)})` : '—',
      notes:
        verdict === 'PASS'
          ? mismatchPct > 0
            ? `Pixel diff within threshold; pixelmatch threshold ${PIXELMATCH_THRESHOLD.toFixed(2)}`
            : ''
          : `Exceeded ${THRESHOLD_PCT.toFixed(2)}% threshold at pixelmatch threshold ${PIXELMATCH_THRESHOLD.toFixed(2)}`,
    });
  }

  const lines = [
    '# E2E App Visual Baseline Diff Report',
    '',
    `- Threshold: ${THRESHOLD_PCT.toFixed(2)}% mismatch per page`,
    `- Pixel diff policy: pixelmatch threshold ${PIXELMATCH_THRESHOLD.toFixed(2)}, anti-alias matching disabled`,
    `- Baseline dir: \`${toRelative(BASELINE_DIR)}\``,
    `- Current dir: \`${toRelative(CURRENT_DIR)}\``,
    `- Diff dir: \`${toRelative(DIFF_DIR)}\``,
    '',
    '| Page | Baseline Size | Current Size | Compared Size | Diff Px | Mismatch % | Verdict | Diff | Notes |',
    '| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |',
  ];

  rows.forEach((row) => {
    const mismatch = row.mismatch == null ? '—' : row.mismatch.toFixed(2);
    const diffPixels = row.diffPixels == null ? '—' : row.diffPixels.toString();
    lines.push(`| ${row.page} | ${row.baselineSize || '—'} | ${row.currentSize || '—'} | ${row.comparedSize || '—'} | ${diffPixels} | ${mismatch} | ${row.verdict} | ${row.diff} | ${row.notes} |`);
  });

  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote report: ${REPORT_PATH}`);

  if (hasFailure) {
    process.exit(1);
  }
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
