"""Bounded MCP stdio discovery for exact deployment-approved process profiles."""

import asyncio
import json
import os
import signal
import time
from datetime import datetime, timezone

from app.connectors.providers.integration_probe import _initialized, PROTOCOL_VERSION, MAX_BYTES
from app.connectors.providers.secrets import environment_secret


async def probe_stdio(definition, settings):
    checked_at = datetime.now(timezone.utc).isoformat()
    profile = {"command": definition.command, "args": list(definition.args), "env": definition.env}
    try:
        allowed = json.loads(settings.mcp_stdio_allowlist)
    except (TypeError, ValueError):
        allowed = []
    if not isinstance(allowed, list) or profile not in allowed:
        return {"status": "blocked", "message": "This command, arguments and environment references must be approved in RCA_MCP_STDIO_ALLOWLIST before testing.", "checked_at": checked_at}
    started = time.monotonic()
    process = None
    try:
        environment = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT", "TMPDIR") if key in os.environ}
        environment.update({key: environment_secret(reference) for key, reference in definition.env.items()})
        async with asyncio.timeout(definition.timeout_seconds):
            process = await asyncio.create_subprocess_exec(
                definition.command, *definition.args, env=environment,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL, limit=MAX_BYTES,
                start_new_session=os.name == "posix",
            )
            message = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                "clientInfo": {"name": "rca-stdio-probe", "version": "1.0"},
            }}
            process.stdin.write(json.dumps(message).encode() + b"\n")
            await process.stdin.drain()
            total_bytes = 0
            for _ in range(32):
                line = await process.stdout.readuntil(b"\n")
                total_bytes += len(line)
                if total_bytes > MAX_BYTES:
                    raise ValueError("MCP response exceeds size limit")
                response = json.loads(line)
                if isinstance(response, dict) and response.get("id") == 1:
                    _initialized(response)
                    break
            else:
                raise ValueError("MCP initialization response missing")
            process.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
            await process.stdin.drain()
        result = {"status": "reachable", "message": "MCP command initialization completed; tool execution was not tested."}
    except (OSError, ValueError, TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
        result = {"status": "failed", "message": "The MCP command failed to initialize within the deadline and response limit. Check the approved command and environment references."}
    finally:
        if process is not None:
            if process.stdin:
                process.stdin.close()
            try:
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGTERM)
                elif process.returncode is None:
                    process.terminate()
                await asyncio.wait_for(process.wait(), 1)
            except (ProcessLookupError, TimeoutError):
                pass
            finally:
                try:
                    if os.name == "posix":
                        os.killpg(process.pid, signal.SIGKILL)
                    elif process.returncode is None:
                        process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()
    return {**result, "checked_at": checked_at, "latency_ms": round((time.monotonic() - started) * 1000)}
