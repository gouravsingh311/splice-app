#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"
source .venv/bin/activate
pip install pyinstaller
pyinstaller splice_api.spec
mkdir -p dist-python
cp dist/splice_api dist-python/splice_api 2>/dev/null || \
  cp dist/splice_api.exe dist-python/splice_api.exe 2>/dev/null || true
echo "Python binary built successfully"
