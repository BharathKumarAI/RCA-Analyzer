"""Serve the deployed, maintained handbooks; never arbitrary filesystem paths."""

import asyncio
import hashlib
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.dependencies import Principal

router = APIRouter(prefix="/api/v1/documentation", tags=["documentation"])
GUIDES = {
    "index": ("Documentation index", "README.md"),
    "project": ("Project and user journeys", "project.md"),
    "architecture": ("Architecture and data flow", "architecture.md"),
    "configuration": ("Configuration and governance", "configuration.md"),
    "development": ("Development and extensions", "development.md"),
    "operations": ("Operations and deployment", "operations.md"),
    "connectors": ("Connector handbook", "connectors.md"),
    "harness": ("Agent harness", "harness.md"),
    "knowledge": ("Knowledge and improvement", "knowledge.md"),
    "data-model": ("Data model", "data-model.md"),
    "security": ("Security boundaries", "security.md"),
}
ROOT = Path(__file__).resolve().parents[3] / "docs"


class GuideInfo(BaseModel):
    id: str
    title: str
    filename: str


class Guide(GuideInfo):
    content: str
    content_hash: str


@router.get("", response_model=list[GuideInfo])
async def list_guides(principal: Principal):
    return [GuideInfo(id=key, title=value[0], filename=value[1]) for key, value in GUIDES.items()]


@router.get("/{guide_id}", response_model=Guide)
async def read_guide(guide_id: str, principal: Principal):
    if guide_id not in GUIDES:
        raise HTTPException(404, "Guide not found")
    title, filename = GUIDES[guide_id]
    try:
        content = await asyncio.to_thread((ROOT / filename).read_bytes)
    except OSError:
        raise HTTPException(503, "The deployed guide is unavailable. Contact the deployment administrator.") from None
    if len(content) > 524288:
        raise HTTPException(503, "The deployed guide exceeds the documentation size limit")
    return Guide(id=guide_id, title=title, filename=filename, content=content.decode("utf-8"),
                 content_hash="sha256:" + hashlib.sha256(content).hexdigest())
