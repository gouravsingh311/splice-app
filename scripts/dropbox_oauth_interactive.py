#!/usr/bin/env python3
"""Interactive Dropbox OAuth bootstrap for local app environments.

This script is intentionally standalone and only runs when explicitly invoked.
It starts a localhost callback server, opens Dropbox OAuth, waits for login,
exchanges the code for tokens, and writes tokens into .env.local.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize"
DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
DEFAULT_CALLBACK_HOST = "127.0.0.1"
DEFAULT_CALLBACK_PORT = 53682
DEFAULT_CALLBACK_PATH = "/dropbox/callback"


def _read_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def _set_env_values(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    out: list[str] = []
    touched: set[str] = set()

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            out.append(line)
            continue
        key, _ = line.split("=", 1)
        k = key.strip()
        if k in updates:
            out.append(f"{k}={updates[k]}")
            touched.add(k)
        else:
            out.append(line)

    for k, v in updates.items():
        if k not in touched:
            out.append(f"{k}={v}")

    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def _require_non_empty(value: str | None, name: str) -> str:
    if value and value.strip():
        return value.strip()
    raise RuntimeError(f"Missing required value: {name}")


def _token_request(payload: dict[str, str]) -> dict[str, object]:
    encoded = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(
        DROPBOX_TOKEN_URL,
        data=encoded,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Dropbox token exchange failed ({exc.code}): {body}") from exc


@dataclass
class OAuthResult:
    code: str | None = None
    error: str | None = None
    state: str | None = None


class _CallbackHandler(BaseHTTPRequestHandler):
    oauth_result: OAuthResult
    expected_path: str
    expected_state: str

    def log_message(self, *_args: object) -> None:  # pragma: no cover
        return

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != self.expected_path:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return

        qs = urllib.parse.parse_qs(parsed.query)
        code = (qs.get("code") or [None])[0]
        error = (qs.get("error_description") or qs.get("error") or [None])[0]
        state = (qs.get("state") or [None])[0]
        self.oauth_result.state = state

        if state != self.expected_state:
            self.oauth_result.error = "State mismatch. Rejecting callback."
            self.send_response(400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b"<html><body><h2>Dropbox setup failed</h2><p>State mismatch.</p></body></html>"
            )
            return

        if error:
            self.oauth_result.error = str(error)
            self.send_response(400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b"<html><body><h2>Dropbox setup failed</h2><p>Authorization was denied.</p></body></html>"
            )
            return

        self.oauth_result.code = code
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            b"<html><body><h2>Dropbox connected</h2><p>You can return to the app.</p></body></html>"
        )


def _start_callback_server(
    host: str, port: int, path: str, state: str
) -> tuple[HTTPServer, OAuthResult, threading.Thread]:
    result = OAuthResult()

    class Handler(_CallbackHandler):
        oauth_result = result
        expected_path = path
        expected_state = state

    server = HTTPServer((host, port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, result, thread


def _build_authorize_url(app_key: str, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": app_key,
        "response_type": "code",
        "token_access_type": "offline",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{DROPBOX_AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


def run(args: argparse.Namespace) -> int:
    env_file = Path(args.env_file).resolve()
    env = _read_env(env_file)

    app_key = _require_non_empty(
        args.app_key or env.get("DROPBOX_APP_KEY"),
        "DROPBOX_APP_KEY",
    )
    app_secret = _require_non_empty(
        args.app_secret or env.get("DROPBOX_APP_SECRET"),
        "DROPBOX_APP_SECRET",
    )

    redirect_host = args.public_host or args.host
    redirect_uri = f"http://{redirect_host}:{args.port}{args.path}"
    state = f"splice-{int(time.time())}"
    server, oauth_result, _thread = _start_callback_server(args.host, args.port, args.path, state)

    try:
        auth_url = _build_authorize_url(app_key, redirect_uri, state)
        print(f"OAuth URL:\n{auth_url}\n")
        opened = False
        if not args.no_open:
            opened = bool(webbrowser.open(auth_url))
        if not opened:
            print("Open the URL manually in your browser.")

        print("Waiting for Dropbox login callback...")
        deadline = time.time() + args.timeout_seconds
        while time.time() < deadline:
            if oauth_result.error:
                raise RuntimeError(f"OAuth callback error: {oauth_result.error}")
            if oauth_result.code:
                break
            time.sleep(0.25)

        code = oauth_result.code
        if not code:
            raise RuntimeError("Timed out waiting for OAuth callback.")

        token_payload = {
            "code": code,
            "grant_type": "authorization_code",
            "client_id": app_key,
            "client_secret": app_secret,
            "redirect_uri": redirect_uri,
        }
        token_response = _token_request(token_payload)
        refresh_token = str(token_response.get("refresh_token") or "").strip()
        access_token = str(token_response.get("access_token") or "").strip()
        if not refresh_token:
            raise RuntimeError(
                "No refresh_token returned. Ensure app allows offline access."
            )

        updates = {
            "DROPBOX_REFRESH_TOKEN": refresh_token,
        }
        if access_token:
            updates["DROPBOX_ACCESS_TOKEN"] = access_token
        _set_env_values(env_file, updates)

        print("Dropbox OAuth completed.")
        print("Updated keys in .env.local:")
        for k in updates:
            print(f" - {k}")
        return 0
    finally:
        server.shutdown()
        server.server_close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Interactive Dropbox OAuth helper for local workspace setup.",
    )
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--app-key", default=None)
    parser.add_argument("--app-secret", default=None)
    parser.add_argument("--host", default=DEFAULT_CALLBACK_HOST)
    parser.add_argument(
        "--public-host",
        default=None,
        help="Host/IP used in redirect URI (defaults to --host).",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_CALLBACK_PORT)
    parser.add_argument("--path", default=DEFAULT_CALLBACK_PATH)
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument("--no-open", action="store_true", help="Do not auto-open browser URL.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return run(args)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
