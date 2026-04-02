#!/usr/bin/env python3
"""Dropbox OAuth helper for app .env.local management.

Usage examples:
  python scripts/dropbox_oauth_helper.py auth-url --app-key "$DROPBOX_APP_KEY"
  python scripts/dropbox_oauth_helper.py exchange-code --code "<AUTH_CODE>" --write-env
  python scripts/dropbox_oauth_helper.py refresh-access --write-env
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize"
DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"


def _load_env(env_file: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_file.exists():
        return values
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def _upsert_env(env_file: Path, updates: dict[str, str]) -> None:
    existing_lines = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
    out_lines: list[str] = []
    touched = set()
    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            out_lines.append(line)
            continue
        key, _ = line.split("=", 1)
        key = key.strip()
        if key in updates:
            out_lines.append(f'{key}="{updates[key]}"')
            touched.add(key)
        else:
            out_lines.append(line)
    for key, value in updates.items():
        if key not in touched:
            out_lines.append(f'{key}="{value}"')
    env_file.write_text("\n".join(out_lines).rstrip() + "\n", encoding="utf-8")


def _token_request(payload: dict[str, str]) -> dict[str, object]:
    encoded = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        DROPBOX_TOKEN_URL,
        data=encoded,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Dropbox token endpoint failed ({exc.code}): {body}") from exc


def _required(value: str | None, name: str) -> str:
    if value and value.strip():
        return value.strip()
    raise RuntimeError(f"Missing required value: {name}")


def _get_credential(args: argparse.Namespace, env: dict[str, str], key: str) -> str:
    cli_value = getattr(args, key.lower(), None)
    if isinstance(cli_value, str) and cli_value.strip():
        return cli_value.strip()
    return _required(env.get(key), key)


def cmd_auth_url(args: argparse.Namespace) -> int:
    app_key = _required(args.app_key, "app_key")
    params = {
        "client_id": app_key,
        "response_type": "code",
        "token_access_type": "offline",
    }
    if args.redirect_uri:
        params["redirect_uri"] = args.redirect_uri
    url = DROPBOX_AUTHORIZE_URL + "?" + urllib.parse.urlencode(params)
    print(url)
    return 0


def cmd_exchange_code(args: argparse.Namespace) -> int:
    env = _load_env(args.env_file)
    app_key = _get_credential(args, env, "DROPBOX_APP_KEY")
    app_secret = _get_credential(args, env, "DROPBOX_APP_SECRET")
    code = _required(args.code, "code")

    payload = {
        "code": code,
        "grant_type": "authorization_code",
        "client_id": app_key,
        "client_secret": app_secret,
    }
    if args.redirect_uri:
        payload["redirect_uri"] = args.redirect_uri

    result = _token_request(payload)
    refresh_token = str(result.get("refresh_token") or "").strip()
    access_token = str(result.get("access_token") or "").strip()
    if not refresh_token:
        raise RuntimeError(
            "No refresh_token in response. Ensure token_access_type=offline was used in auth URL."
        )

    print("refresh_token acquired: yes")
    print("access_token acquired:", "yes" if access_token else "no")
    if args.write_env:
        updates = {
            "DROPBOX_APP_KEY": app_key,
            "DROPBOX_APP_SECRET": app_secret,
            "DROPBOX_REFRESH_TOKEN": refresh_token,
        }
        if access_token:
            updates["DROPBOX_ACCESS_TOKEN"] = access_token
        _upsert_env(args.env_file, updates)
        print(f"updated env file: {args.env_file}")
    else:
        print("DROPBOX_REFRESH_TOKEN=", refresh_token)
        if access_token:
            print("DROPBOX_ACCESS_TOKEN=", access_token)
    return 0


def cmd_refresh_access(args: argparse.Namespace) -> int:
    env = _load_env(args.env_file)
    app_key = _get_credential(args, env, "DROPBOX_APP_KEY")
    app_secret = _get_credential(args, env, "DROPBOX_APP_SECRET")
    refresh_token = _get_credential(args, env, "DROPBOX_REFRESH_TOKEN")

    result = _token_request(
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": app_key,
            "client_secret": app_secret,
        }
    )
    access_token = str(result.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError("No access_token in refresh response.")
    print("access_token refreshed: yes")
    if args.write_env:
        _upsert_env(args.env_file, {"DROPBOX_ACCESS_TOKEN": access_token})
        print(f"updated env file: {args.env_file}")
    else:
        print("DROPBOX_ACCESS_TOKEN=", access_token)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Dropbox OAuth helper for .env.local")
    parser.add_argument(
        "--env-file",
        type=Path,
        default=Path(".env.local"),
        help="Path to env file (default: .env.local).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    auth = sub.add_parser("auth-url", help="Print OAuth authorize URL.")
    auth.add_argument("--app-key", required=True, help="Dropbox app key.")
    auth.add_argument("--redirect-uri", help="Optional redirect URI.")
    auth.set_defaults(func=cmd_auth_url)

    exchange = sub.add_parser("exchange-code", help="Exchange auth code for tokens.")
    exchange.add_argument("--code", required=True, help="Authorization code from Dropbox.")
    exchange.add_argument("--dropbox_app_key", help="Override DROPBOX_APP_KEY.")
    exchange.add_argument("--dropbox_app_secret", help="Override DROPBOX_APP_SECRET.")
    exchange.add_argument("--redirect-uri", help="Optional redirect URI.")
    exchange.add_argument("--write-env", action="store_true", help="Write tokens into env file.")
    exchange.set_defaults(func=cmd_exchange_code)

    refresh = sub.add_parser("refresh-access", help="Refresh access token using refresh token.")
    refresh.add_argument("--dropbox_app_key", help="Override DROPBOX_APP_KEY.")
    refresh.add_argument("--dropbox_app_secret", help="Override DROPBOX_APP_SECRET.")
    refresh.add_argument("--dropbox_refresh_token", help="Override DROPBOX_REFRESH_TOKEN.")
    refresh.add_argument("--write-env", action="store_true", help="Write access token into env file.")
    refresh.set_defaults(func=cmd_refresh_access)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
