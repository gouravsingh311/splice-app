const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..', '..');
const REFERENCE_ROOT = path.join(ROOT, 'docs', 'reports', 'assets', 'UI4-TW4-E-REFERENCE');
const LOCAL_ROOT = path.join(ROOT, 'docs', 'reports', 'assets', 'UI4-TW4-E-LOCAL');
const DIFF_ROOT = path.join(ROOT, 'docs', 'reports', 'assets', 'UI4-TW4-E-DIFF');
const REPORT_PATH = path.join(ROOT, 'docs', 'reports', 'UI4-TW4-E-visual-diff-report.md');
const viewports = ['1440x900', '1920x1080'];

const pageMap = [
  { reference: 'login', local: 'auth', verdict: 'overlap' },
  { reference: 'dashboard', local: 'dashboard', verdict: 'overlap' },
  { reference: 'projects', local: 'submissions', verdict: 'proxy' },
  { reference: 'ops-submissions', local: 'reviewer-queue', verdict: 'proxy' },
  { reference: 'notifications', local: 'notifications', verdict: 'overlap' },
  { reference: 'teams', local: null, verdict: 'no-local-surface' },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function calculateDiff(pixelmatch, refPath, localPath, outputPath) {
  const refPng = readPng(refPath);
  const localPng = readPng(localPath);
  const width = Math.min(refPng.width, localPng.width);
  const height = Math.min(refPng.height, localPng.height);

  const refCrop = new PNG({ width, height });
  const localCrop = new PNG({ width, height });
  PNG.bitblt(refPng, refCrop, 0, 0, width, height, 0, 0);
  PNG.bitblt(localPng, localCrop, 0, 0, width, height, 0, 0);

  const diff = new PNG({ width, height });
  const mismatchPixels = pixelmatch(refCrop.data, localCrop.data, diff.data, width, height, {
    threshold: 0.12,
    includeAA: false,
  });
  fs.writeFileSync(outputPath, PNG.sync.write(diff));
  const total = width * height;
  const mismatchPct = total > 0 ? (mismatchPixels / total) * 100 : 0;
  return { width, height, mismatchPixels, mismatchPct };
}

function classify(mismatchPct) {
  if (mismatchPct <= 3) {
    return 'PASS';
  }
  if (mismatchPct <= 9) {
    return 'MINOR DRIFT';
  }
  return 'MAJOR DRIFT';
}

function toRelative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

async function run() {
  const pixelmatchModule = await import('pixelmatch');
  const pixelmatch = pixelmatchModule.default;
  ensureDir(DIFF_ROOT);
  const rows = [];

  for (const mapping of pageMap) {
    for (const viewport of viewports) {
      const referenceShot = path.join(REFERENCE_ROOT, mapping.reference, viewport, 'screenshot.png');
      if (!fs.existsSync(referenceShot)) {
        rows.push({
          page: mapping.reference,
          local: mapping.local || 'N/A',
          viewport,
          mismatchPct: null,
          verdict: 'MISSING REFERENCE',
          diffPath: '',
          note: 'Reference screenshot missing.',
        });
        continue;
      }

      if (!mapping.local) {
        rows.push({
          page: mapping.reference,
          local: 'N/A',
          viewport,
          mismatchPct: null,
          verdict: 'N/A',
          diffPath: '',
          note: 'No equivalent local nav surface.',
        });
        continue;
      }

      const localShot = path.join(LOCAL_ROOT, mapping.local, viewport, 'screenshot.png');
      if (!fs.existsSync(localShot)) {
        rows.push({
          page: mapping.reference,
          local: mapping.local,
          viewport,
          mismatchPct: null,
          verdict: 'MISSING LOCAL',
          diffPath: '',
          note: 'Local screenshot missing. Run `npm run parity:capture:local`.',
        });
        continue;
      }

      const outputDir = path.join(DIFF_ROOT, mapping.reference + '__' + mapping.local, viewport);
      ensureDir(outputDir);
      const diffPath = path.join(outputDir, 'diff.png');
      const result = calculateDiff(pixelmatch, referenceShot, localShot, diffPath);
      rows.push({
        page: mapping.reference,
        local: mapping.local,
        viewport,
        mismatchPct: result.mismatchPct,
        verdict: classify(result.mismatchPct),
        diffPath: toRelative(diffPath),
        note: mapping.verdict === 'proxy' ? 'Proxy mapping (no 1:1 page parity).' : '',
      });
    }
  }

  const report = [];
  report.push('# UI4-TW4-E Visual Diff Report');
  report.push('');
  report.push('- Reference assets: `docs/reports/assets/UI4-TW4-E-REFERENCE`');
  report.push('- Local assets: `docs/reports/assets/UI4-TW4-E-LOCAL`');
  report.push('- Diff assets: `docs/reports/assets/UI4-TW4-E-DIFF`');
  report.push('');
  report.push('| Reference Page | Local Page | Viewport | Mismatch % | Verdict | Diff | Notes |');
  report.push('| --- | --- | --- | ---: | --- | --- | --- |');
  rows.forEach((row) => {
    const pct = row.mismatchPct == null ? '—' : row.mismatchPct.toFixed(2);
    const diffLink = row.diffPath ? '[' + path.basename(row.diffPath) + '](' + row.diffPath + ')' : '—';
    report.push('| ' + row.page + ' | ' + row.local + ' | ' + row.viewport + ' | ' + pct + ' | ' + row.verdict + ' | ' + diffLink + ' | ' + (row.note || '') + ' |');
  });
  report.push('');
  report.push('## Thresholds');
  report.push('- `PASS`: mismatch <= 3%');
  report.push('- `MINOR DRIFT`: mismatch > 3% and <= 9%');
  report.push('- `MAJOR DRIFT`: mismatch > 9%');
  fs.writeFileSync(REPORT_PATH, report.join('\n') + '\n', 'utf8');

  process.stdout.write('Wrote visual diff report: ' + REPORT_PATH + '\n');
}

run().catch((error) => {
  process.stderr.write(error.message + '\n');
  process.exit(1);
});
