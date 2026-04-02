function normalizeAppName(appName) {
  if (!appName) return "App";
  return appName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildWindowTitle(appName) {
  return `${normalizeAppName(appName)} Desktop`;
}

module.exports = {
  buildWindowTitle,
  normalizeAppName,
};
