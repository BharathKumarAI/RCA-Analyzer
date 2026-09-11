"""Provision local project folders without overwriting existing configuration."""

import argparse
from pathlib import Path

import yaml

from app.configuration.models import ProjectLayer, UserLayer
from app.connectors.providers.project_storage import project_prefix, scope_key
from app.settings import CONTENT_ROOT

from app.connectors.providers.artifact_layout import PROJECT_FOLDERS

LAYOUT = PROJECT_FOLDERS


def initialize_project(
    root: Path, tenant_id: str, project_id: str, subject: str | None = None
) -> Path:
    root = root.expanduser().resolve()
    project = root / project_prefix(tenant_id, project_id)

    def create(path, text):
        if path.is_symlink() or path.resolve() != path.absolute():
            raise ValueError("Project initialization cannot follow symlinks")
        try:
            with path.open("x", encoding="utf-8") as handle:
                handle.write(text)
        except FileExistsError:
            pass  # Operator edits and immutable artifacts are never overwritten.

    for relative, description in LAYOUT.items():
        directory = project / relative
        if directory.resolve() != directory.absolute():
            raise ValueError("Project initialization cannot follow symlinks")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        create(directory / "README.md", f"# {relative}\n\n{description}")
    source = project / "configuration/project.yaml"
    definition = ProjectLayer(tenant_id=tenant_id, project_id=project_id)
    create(
        source,
        yaml.safe_dump(
            definition.model_dump(mode="json", exclude_unset=True), sort_keys=False
        ),
    )
    # Validate existing identity rather than silently reassigning a folder.
    from app.configuration.yaml_data import load_yaml_data

    existing = ProjectLayer.model_validate(load_yaml_data(source.read_text()))
    if (existing.tenant_id, existing.project_id) != (tenant_id, project_id):
        raise ValueError("Existing project configuration has another scope")
    if subject is not None:
        user = UserLayer(tenant_id=tenant_id, project_id=project_id, subject=subject)
        user_path = project / "configuration/users" / f"{scope_key(subject)}.yaml"
        create(
            user_path,
            yaml.safe_dump(
                user.model_dump(mode="json", exclude_unset=True), sort_keys=False
            ),
        )
        existing_user = UserLayer.model_validate(load_yaml_data(user_path.read_text()))
        if (
            existing_user.tenant_id,
            existing_user.project_id,
            existing_user.subject,
        ) != (tenant_id, project_id, subject):
            raise ValueError("Existing user configuration has another scope")
    return project


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--subject")
    parser.add_argument("--root", type=Path, default=CONTENT_ROOT.parent / "projects")
    args = parser.parse_args()
    print(initialize_project(args.root, args.tenant, args.project, args.subject))


if __name__ == "__main__":
    main()
