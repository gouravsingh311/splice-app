function normalizeAppName(appName) {
  return String(appName || "Splice App")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildWindowTitle(appName) {
  return `${normalizeAppName(appName)} Desktop`;
}

module.exports = {
  buildWindowTitle,
  normalizeAppName,
};
