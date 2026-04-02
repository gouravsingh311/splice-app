#!/usr/bin/env bash
set -euo pipefail

npm ci
npm run build:css
npm run lint
npm test
npm run smoke:start

echo "Bootstrap complete. Use 'npm start' to launch the desktop app."
