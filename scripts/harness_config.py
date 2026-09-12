"""Authenticated Harness Studio configuration CLI.

The CLI talks only to the Harness Studio API. It never imports or executes
uploaded configuration, and import creates a server-side draft that still
follows the normal review lifecycle.
"""

from __future__ import annotations

import argparse
import difflib
import io
import json
import os
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

import httpx2


DEFAULT_API_URL = "http://127.0.0.1:8000"
WORKSPACE_PATH = "/api/v1/harness/workspace"
MAX_FILES = 100
MAX_FILE_BYTES = 64 * 1024
MAX_TOTAL_BYTES = 512 * 1024
SKIP_DIRECTORIES = {".git", ".venv", "node_modules", "__pycache__"}
SECRET_KEY = re.compile(r"(token|secret|password|private[_-]?key|api[_-]?key)", re.I)
SECRET_LINE = re.compile(
    r"(?i)(\b(?:token|secret|password|private[_-]?key|api[_-]?key)\b\s*[:=]\s*)([^\s#]+)"
)


class CliError(RuntimeError):
    """A user-actionable CLI error that does not include credentials."""


def _token() -> str:
    for name in ("RCA_API_TOKEN", "RCA_TOKEN"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    raise CliError("Set RCA_API_TOKEN before calling the Harness Studio API")


def _api_url(value: str | None) -> str:
    return (value or os.environ.get("RCA_API_URL") or DEFAULT_API_URL).rstrip("/")


class ApiClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = _api_url(base_url)
        self.client = httpx2.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {_token()}", "Accept": "application/json"},
            timeout=float(os.environ.get("RCA_API_TIMEOUT", "30")),
        )

    def close(self) -> None:
        self.client.close()

    def request(self, method: str, path: str, **kwargs: Any) -> httpx2.Response:
        try:
            response = self.client.request(method, path, **kwargs)
        except httpx2.HTTPError as exc:
            raise CliError(f"Request to {self.base_url} failed: {exc.__class__.__name__}") from None
        if response.is_success:
            return response
        message = f"API request failed with HTTP {response.status_code}"
        if response.status_code == 401:
            message += "; check RCA_API_TOKEN"
        elif response.status_code == 403:
            message += "; the authenticated principal is not allowed"
        elif response.status_code == 409:
            message += "; reload the workspace and retry"
        elif response.status_code == 422:
            message += "; the configuration was rejected by validation"
        raise CliError(message)

    def json(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.request(method, path, **kwargs)
        try:
            return response.json()
        except ValueError:
            raise CliError("API returned a non-JSON response") from None


def _safe_name(path: Path) -> str:
    if path.is_symlink():
        raise CliError(f"Symlinks are not accepted: {path}")
    return path.as_posix()


def read_files(source: str | Path) -> dict[str, str]:
    """Read a local file or directory as UTF-8 data; no file is executed."""

    root = Path(source)
    if not root.exists():
        raise CliError(f"Configuration path does not exist: {root}")
    if root.is_symlink():
        raise CliError(f"Symlinks are not accepted: {root}")
    paths = [root] if root.is_file() else [
        path
        for path in sorted(root.rglob("*"))
        if path.is_file() and not path.is_symlink()
        and not any(part in SKIP_DIRECTORIES for part in path.relative_to(root).parts)
    ]
    if len(paths) > MAX_FILES:
        raise CliError(f"Configuration contains more than {MAX_FILES} files")
    files: dict[str, str] = {}
    total = 0
    for path in paths:
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise CliError(f"Configuration file exceeds {MAX_FILE_BYTES} bytes: {path}")
        total += size
        if total > MAX_TOTAL_BYTES:
            raise CliError(f"Configuration exceeds {MAX_TOTAL_BYTES} total bytes")
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise CliError(f"Configuration file must be UTF-8 text: {path}") from None
        name = path.name if root.is_file() else path.relative_to(root).as_posix()
        posix_name = PurePosixPath(name)
        if (not name or name.startswith("../") or posix_name.is_absolute()
                or "\\" in name or ":" in name or "\x00" in name
                or ".." in posix_name.parts):
            raise CliError(f"Invalid configuration file name: {name}")
        if any(part.startswith(".") for part in posix_name.parts):
            raise CliError(f"Hidden files cannot be imported: {name}")
        if (posix_name.name.lower() in {"credentials.json", "secrets.yaml", "secrets.yml"}
                or posix_name.suffix.lower() in {".pem", ".key", ".p12"}):
            raise CliError(f"Credential files cannot be imported: {name}")
        files[_safe_name(Path(name))] = content
    if not files:
        raise CliError(f"No configuration files found under {root}")
    return files


def zip_files(files: dict[str, str]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            archive.writestr(name, files[name])
    return output.getvalue()


def workspace_files(payload: Any) -> dict[str, str]:
    if isinstance(payload, dict):
        files = payload.get("files")
        if isinstance(files, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in files.items()):
            return files
        for key in ("workspace", "data", "result"):
            nested = payload.get(key)
            if nested is not payload:
                found = workspace_files(nested)
                if found:
                    return found
    return {}


def _safe_payload(value: Any, key: str = "") -> Any:
    if SECRET_KEY.search(key):
        return "[redacted]"
    if key == "files":
        if isinstance(value, dict):
            return {name: "[content omitted]" for name in sorted(value)}
        return "[content omitted]"
    if isinstance(value, dict):
        return {name: _safe_payload(item, name) for name, item in value.items()}
    if isinstance(value, list):
        return [_safe_payload(item, key) for item in value]
    return value


def print_json(value: Any) -> None:
    print(json.dumps(_safe_payload(value), indent=2, sort_keys=True))


def validate(args: argparse.Namespace) -> int:
    files = read_files(args.path)
    api = ApiClient(args.api_url)
    try:
        result = api.json("POST", "/api/v1/harness/validate", json={"files": files, "capability": args.capability})
    finally:
        api.close()
    print_json(result)
    return 0


def import_bundle(args: argparse.Namespace) -> int:
    path = Path(args.path)
    if path.is_dir():
        bundle = zip_files(read_files(path))
        filename = f"{path.name or 'harness'}.zip"
    else:
        if not path.is_file():
            raise CliError(f"Import bundle does not exist: {path}")
        if path.stat().st_size > MAX_TOTAL_BYTES:
            raise CliError(f"Import bundle exceeds {MAX_TOTAL_BYTES} bytes")
        bundle = path.read_bytes()
        filename = path.name
    api = ApiClient(args.api_url)
    try:
        result = api.json(
            "POST",
            "/api/v1/harness/import",
            data={"capability": args.capability},
            files={"file": (filename, bundle, "application/zip")},
        )
    finally:
        api.close()
    print_json(result)
    return 0


def export_bundle(args: argparse.Namespace) -> int:
    output = Path(args.output)
    params = {"capability": args.capability}
    if args.draft_id:
        params["draft_id"] = args.draft_id
    api = ApiClient(args.api_url)
    try:
        response = api.request("GET", "/api/v1/harness/export", params=params, headers={"Accept": "application/zip, application/octet-stream"})
    finally:
        api.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(response.content)
    print(f"Exported {output}")
    return 0


def diff_workspace(args: argparse.Namespace) -> int:
    local = read_files(args.path)
    api = ApiClient(args.api_url)
    try:
        remote = api.json("GET", "/api/v1/harness/workspace", params={"capability": args.capability})
    finally:
        api.close()
    remote_files = workspace_files(remote)
    if not remote_files:
        raise CliError("Workspace response did not contain files")
    output: list[str] = []
    for name in sorted(set(local) | set(remote_files)):
        output.extend(
            difflib.unified_diff(
                [line + "\n" for line in remote_files.get(name, "").splitlines()],
                [line + "\n" for line in local.get(name, "").splitlines()],
                fromfile=f"remote/{name}",
                tofile=f"local/{name}",
            )
        )
    if not output:
        print("No differences.")
        return 0
    print("".join(SECRET_LINE.sub(r"\1[redacted]", line) for line in output), end="")
    return 1


def parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--capability", required=True, help="Capability ID being configured")
    common.add_argument("--api-url", default=None, help="API base URL (defaults to RCA_API_URL)")
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    for name, function, help_text in (
        ("validate", validate, "Validate local files without creating a draft"),
        ("import", import_bundle, "Upload a bundle or directory as a server-side draft"),
        ("diff", diff_workspace, "Compare local files with the remote workspace"),
    ):
        command = commands.add_parser(name, parents=[common], help=help_text)
        command.add_argument("path", help="Local file or directory")
        command.set_defaults(function=function)
    command = commands.add_parser("export", parents=[common], help="Download an approved or selected workspace bundle")
    command.add_argument("--draft-id", default=None)
    command.add_argument("--output", default=None, help="Output archive path")
    command.set_defaults(function=export_bundle)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "export" and not args.output:
        args.output = f"{args.capability}.zip"
    try:
        return args.function(args)
    except CliError as exc:
        print(f"harness-config: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
