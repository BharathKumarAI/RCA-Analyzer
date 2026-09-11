"""Content-addressed agent YAML blobs, locally or in Google Cloud Storage.

The service stores a hash, never a caller-provided path. Credentials for GCS use
Application Default Credentials and remain entirely within this provider.
"""

import asyncio
import hashlib
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit


class ConfigurationBlobStore:
    def __init__(
        self,
        uri: str = "./blob_local/agent-configurations",
        max_bytes: int = 65536,
        *,
        binary: bool = False,
        suffix: str | None = None,
    ):
        if suffix not in {None, ".json"}:
            raise ValueError("Unsupported blob suffix")
        self.suffix = suffix
        self.binary = binary
        self.max_bytes = max_bytes
        self._bucket = None
        self._prefix = ""
        if uri.startswith("gs://"):
            from google.cloud import storage

            parsed = urlsplit(uri)
            if not parsed.netloc or parsed.query or parsed.fragment:
                raise ValueError("Invalid configuration blob URI")
            self._bucket = storage.Client().bucket(parsed.netloc)
            self._prefix = parsed.path.strip("/")
            self._root = None
        else:
            if "://" in uri:
                raise ValueError("Blob storage supports a local directory or gs:// URI")
            self._root = Path(uri).resolve()
            self._root.mkdir(parents=True, exist_ok=True, mode=0o700)

    @staticmethod
    def _digest(data: bytes) -> str:
        return "sha256:" + hashlib.sha256(data).hexdigest()

    def _key(self, digest: str) -> str:
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            raise ValueError("Invalid blob content hash")
        return digest[7:] + (self.suffix or (".bin" if self.binary else ".yaml"))

    async def put(self, data: bytes) -> str:
        if not data or len(data) > self.max_bytes:
            raise ValueError("Agent YAML exceeds configured blob size")
        digest = self._digest(data)
        key = self._key(digest)

        def write():
            if self._bucket is not None:
                from google.api_core.exceptions import PreconditionFailed

                blob = self._bucket.blob("/".join(filter(None, [self._prefix, key])))
                try:
                    blob.upload_from_string(
                        data,
                        content_type="application/octet-stream"
                        if self.binary
                        else "application/yaml",
                        if_generation_match=0,
                        timeout=10,
                    )
                except PreconditionFailed:
                    pass  # Existing immutable object is verified below.
            else:
                path = self._root / key
                with tempfile.NamedTemporaryFile(
                    dir=self._root, prefix=".pending-", delete=False
                ) as handle:
                    temporary = Path(handle.name)
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
                try:
                    try:
                        os.link(
                            temporary, path
                        )  # Atomic, never overwrites an existing version.
                    except FileExistsError:
                        pass
                finally:
                    temporary.unlink(missing_ok=True)

        await asyncio.to_thread(write)
        if await self.get(digest) != data:
            raise ValueError("Existing configuration blob does not match its hash")
        return digest

    async def get(self, digest: str) -> bytes:
        key = self._key(digest)

        def read():
            if self._bucket is not None:
                blob = self._bucket.blob("/".join(filter(None, [self._prefix, key])))
                blob.reload(timeout=10)
                if blob.size is None or blob.size > self.max_bytes:
                    raise ValueError("Configuration blob exceeds size limit")
                return blob.download_as_bytes(
                    if_generation_match=blob.generation, timeout=10
                )
            path = self._root / key
            with path.open("rb") as handle:
                return handle.read(self.max_bytes + 1)

        data = await asyncio.to_thread(read)
        if len(data) > self.max_bytes or self._digest(data) != digest:
            raise ValueError("Configuration blob failed integrity verification")
        return data

    async def delete(self, digest: str):
        """Idempotent deletion; callers own retention and reference checks."""
        key = self._key(digest)

        def remove():
            if self._bucket is not None:
                from google.api_core.exceptions import NotFound

                try:
                    self._bucket.blob(
                        "/".join(filter(None, [self._prefix, key]))
                    ).delete(timeout=10)
                except NotFound:
                    pass
            else:
                (self._root / key).unlink(missing_ok=True)
                if self.binary:
                    for temporary in self._root.glob(".pending-*"):
                        temporary.unlink(missing_ok=True)

        await asyncio.to_thread(remove)
