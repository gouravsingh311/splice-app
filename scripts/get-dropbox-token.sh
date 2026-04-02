#!/bin/bash
# Gets Dropbox token and writes it to .env.local
# Supports two modes:
#   1. DROPBOX_ACCESS_TOKEN already in .env.local → use it directly (from Dropbox App Console)
#   2. DROPBOX_AUTH_CODE in .env.local → exchange for refresh token via OAuth2

set -e

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env.local not found at $ENV_FILE"
  exit 1
fi

get_env() {
  grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d ' '
}

write_env() {
  KEY=$1; VAL=$2
  if grep -q "^$KEY=" "$ENV_FILE"; then
    sed -i '' "s|^$KEY=.*|$KEY=$VAL|" "$ENV_FILE"
    echo "✏️  Updated $KEY in .env.local"
  else
    echo "$KEY=$VAL" >> "$ENV_FILE"
    echo "✏️  Added $KEY to .env.local"
  fi
}

ACCESS_TOKEN=$(get_env "DROPBOX_ACCESS_TOKEN")

# Mode 1 — direct access token already present (from Dropbox App Console)
if [ -n "$ACCESS_TOKEN" ]; then
  echo "✅ DROPBOX_ACCESS_TOKEN already set. Verifying with Dropbox..."
  RESP=$(curl -s -X POST https://api.dropboxapi.com/2/users/get_current_account \
    --header "Authorization: Bearer $ACCESS_TOKEN")
  EMAIL=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('email',''))" 2>/dev/null)
  if [ -z "$EMAIL" ]; then
    echo "❌ Token invalid. Response: $RESP"
    exit 1
  fi
  echo "🎉 Token valid — connected as: $EMAIL"
  echo ""
  echo "ℹ️  This is a long-lived access token (no refresh needed)."
  echo "    The app will use DROPBOX_ACCESS_TOKEN directly."
  exit 0
fi

# Mode 2 — exchange auth code for refresh token
APP_KEY=$(get_env "DROPBOX_APP_KEY")
APP_SECRET=$(get_env "DROPBOX_APP_SECRET")
AUTH_CODE=$(get_env "DROPBOX_AUTH_CODE")

if [ -z "$APP_KEY" ] || [ -z "$APP_SECRET" ] || [ -z "$AUTH_CODE" ]; then
  echo "❌ Need either DROPBOX_ACCESS_TOKEN or all of:"
  echo "   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_AUTH_CODE"
  echo ""
  echo "Tip: The easiest option is to copy the 'Generated access token' from"
  echo "     your Dropbox App Console and add it to .env.local as:"
  echo "     DROPBOX_ACCESS_TOKEN=sl.XXXXXXXXXX"
  exit 1
fi

echo "🔄 Exchanging auth code for refresh token (must run within ~60s of generating code)..."

RESPONSE=$(curl -s -X POST https://api.dropbox.com/oauth2/token \
  -d "code=$AUTH_CODE" \
  -d "grant_type=authorization_code" \
  -d "client_id=$APP_KEY" \
  -d "client_secret=$APP_SECRET")

REFRESH_TOKEN=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('refresh_token',''))" 2>/dev/null)

if [ -z "$REFRESH_TOKEN" ]; then
  echo "❌ Failed. Response: $RESPONSE"
  echo ""
  echo "Tip: Auth codes expire in seconds. Generate a new one and run this script IMMEDIATELY."
  echo "     Or just use the 'Generated access token' from your Dropbox App Console instead:"
  echo "     Add DROPBOX_ACCESS_TOKEN=sl.XXXXXXXXXX to .env.local and re-run."
  exit 1
fi

write_env "DROPBOX_REFRESH_TOKEN" "$REFRESH_TOKEN"
echo "🎉 Done. Remove DROPBOX_AUTH_CODE from .env.local (it's now expired/used)."

