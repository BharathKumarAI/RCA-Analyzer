"""Scoped, data-only workspace presentation settings."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.api.dependencies import Principal, require_roles
from app.configuration.service import ADMIN_ROLES

router = APIRouter(prefix="/api/v1/platform/ui-settings", tags=["ui-settings"])

SUPPORTED_UI_PAGES = frozenset({
    "chat", "insights", "metrics", "overview", "runs", "capabilities", "skills", "runtime", "parameters",
    "optimization", "agents", "tools", "alerts", "health-checks", "project-setup",
    "persistence", "policy", "roles", "governance", "knowledge", "users", "billing",
    "settings", "harness-library", "triage-board",
    "tickets", "rca-workbench", "feedback", "docs", "platform-docs", "artifacts", "orchestration",
})


class NavigationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    label: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=240)
    group: str = Field(default="Workspace", min_length=1, max_length=80)
    visible: bool = True


class UISettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brand_name: str = Field(min_length=1, max_length=120)
    workspace_label: str = Field(min_length=1, max_length=120)
    default_theme: Literal["light", "dark", "system"] = "light"
    default_page: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    welcome_title: str = Field(min_length=1, max_length=200)
    welcome_description: str = Field(default="", max_length=1000)
    navigation: list[NavigationItem] = Field(min_length=1, max_length=len(SUPPORTED_UI_PAGES))
    expected_version: int = Field(ge=1)

    @field_validator("navigation")
    @classmethod
    def validate_navigation(cls, items: list[NavigationItem]) -> list[NavigationItem]:
        pages = [item.page for item in items]
        if len(pages) != len(set(pages)):
            raise ValueError("Navigation pages must be unique")
        unknown = set(pages) - SUPPORTED_UI_PAGES
        missing = SUPPORTED_UI_PAGES - set(pages)
        if unknown:
            raise ValueError("Navigation contains an unsupported page")
        if missing:
            raise ValueError("Navigation must include every supported page")
        required = {"overview", "settings"}
        by_page = {item.page: item for item in items}
        if not required.issubset(by_page) or any(not by_page[p].visible for p in required):
            raise ValueError("Overview and Settings must remain visible")
        return items

    @model_validator(mode="after")
    def validate_default_page(self):
        visible = {item.page for item in self.navigation if item.visible}
        if self.default_page not in visible:
            raise ValueError("Default page must be visible in navigation")
        return self


@router.get("")
async def get_ui_settings(request: Request, principal: Principal):
    store = getattr(request.app.state, "platform_admin", None)
    if store is None:
        raise HTTPException(500, "Platform admin store not initialized")
    return await store.get_ui_settings(principal.tenant_id, principal.project_id)


@router.put("")
async def update_ui_settings(body: UISettingsUpdate, request: Request, principal: Principal):
    require_roles(principal, ADMIN_ROLES)
    store = getattr(request.app.state, "platform_admin", None)
    if store is None:
        raise HTTPException(500, "Platform admin store not initialized")
    try:
        payload = body.model_dump(exclude={"expected_version"})
        payload["navigation"] = [item.model_dump() for item in body.navigation]
        return await store.update_ui_settings(
            principal.tenant_id, principal.project_id, payload, body.expected_version
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
