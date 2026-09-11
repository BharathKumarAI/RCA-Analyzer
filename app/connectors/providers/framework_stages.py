"""Rebuildable approval-stage views over immutable canonical framework blobs."""

import re
from pathlib import Path

from app.connectors.providers.blob import ConfigurationBlobStore

STAGES = {
    "PENDING": "pending-approval",
    "APPROVED": "approved",
    "REJECTED": "rejected",
    "REVOKED": "revoked",
}


class FrameworkStageStore:
    def __init__(self, settings):
        self.settings = settings

    def _store(self, draft_id, stage):
        if (
            not re.fullmatch(r"draft_[0-9a-f]{32}", draft_id)
            or stage not in STAGES.values()
        ):
            raise ValueError("Invalid framework stage namespace")
        uri = f"{self.settings.artifact_uri('framework-uploads').rstrip('/')}/agents/{stage}/{draft_id}"
        if not uri.startswith("gs://") and Path(uri).resolve() != Path(uri).absolute():
            raise ValueError("Framework stage paths cannot follow symlinks")
        return ConfigurationBlobStore(uri, self.settings.max_agent_yaml_bytes)

    async def sync(self, draft_id, status, digest, content):
        target = STAGES[status]
        if await self._store(draft_id, target).put(content) != digest:
            raise ValueError("Framework stage hash mismatch")
        # Copy + verify before delete works on both local storage and GCS.
        for stage in STAGES.values():
            if stage != target:
                await self._store(draft_id, stage).delete(digest)
