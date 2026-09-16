"""One documented directory vocabulary for project blob artifacts."""

FRAMEWORK_TYPES = ("agents", "skills", "prompts", "capabilities", "configuration")
FRAMEWORK_STAGES = (
    "draft",
    "pending-approval",
    "approved",
    "rejected",
    "revoked",
    "archived",
)

# These are folders and documentation only, never empty Python packages.
PROJECT_FOLDERS = {
    "configuration": "Active deployment project configuration. Operator-managed; restart after edits. No secrets.\n",
    "configuration/users": "Active delegated user preferences, named with scope_key(subject).\n",
    "artifacts/framework/objects/agents": "Immutable canonical agent definitions. SQLAlchemy approval and active pointers control execution.\n",
    "artifacts/framework/optimizations/objects": "Immutable optimization datasets and evaluated bundles; review state lives in SQLAlchemy.\n",
    "artifacts/chats": "Separate chat_<id>/uploads and chat_<id>/created branches. See docs/reference/data-access-and-operations.md#blob-storage.\n",
    "exports": "Operator-managed exports; not an execution input.\n",
}
for kind in FRAMEWORK_TYPES:
    for stage in FRAMEWORK_STAGES:
        live = kind == "agents" and stage in {
            "pending-approval",
            "approved",
            "rejected",
            "revoked",
        }
        PROJECT_FOLDERS[f"artifacts/framework/uploads/{kind}/{stage}"] = (
            f"{'Implemented agent approval stage view' if live else 'Reserved stage; no submission/promotion API in this release'}. "
            "Folders alone never activate content. Immutable objects and SQLAlchemy audit remain authoritative.\n"
        )

CHAT_FOLDERS = {
    "uploads/raw": "Original accepted uploads, unchanged; never supplied directly to agents.\n",
    "uploads/processed": "Redacted extraction JSON derived from originals; retained for the extraction TTL.\n",
    "created/completed": "Generated final run/evidence JSON for successful or partial runs.\n",
    "created/failed": "Generated terminal run/evidence JSON for failed, blocked or cancelled runs.\n",
    "created/simulated": "Explicitly simulated demo run JSON.\n",
}

for stage in ("raw", "processed", "rejected", "archived"):
    PROJECT_FOLDERS[f"artifacts/framework/uploads/files/{stage}"] = (
        "Reserved for future framework reference-file ingestion. No upload or processing API exists for this branch. "
        "Chat files use each chat's uploads directory instead.\n"
    )
