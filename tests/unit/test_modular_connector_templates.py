"""Unit tests for modular connector template loading, parity, fallback, and validation."""

from pathlib import Path
import shutil
import tempfile
import pytest

from app.configuration.models import ConnectorTemplate
from app.configuration.platform import PlatformConfiguration
from app.settings import Settings


def test_modular_and_legacy_templates_parity():
    """Verify loaded templates from connector_templates/ match the legacy file."""
    settings = Settings()
    modular_platform = PlatformConfiguration.load(settings)
    assert len(modular_platform.connector_templates) >= 10

    # Load legacy directly
    legacy_text = (settings.config_dir / "connector_templates.yaml").read_text()
    from app.configuration.yaml_data import load_yaml_data
    from app.configuration.platform import _normalize_legacy_connector_template
    legacy_rows = [
        ConnectorTemplate.model_validate(_normalize_legacy_connector_template(r))
        for r in load_yaml_data(legacy_text)
    ]
    assert len(modular_platform.connector_templates) == len(legacy_rows)

    modular_by_key = {(t.system_name, t.version): t for t in modular_platform.connector_templates}
    for legacy_tmpl in legacy_rows:
        key = (legacy_tmpl.system_name, legacy_tmpl.version)
        assert key in modular_by_key, f"Missing template {key}"
        mod_tmpl = modular_by_key[key]
        assert mod_tmpl.model_dump() == legacy_tmpl.model_dump()


def test_legacy_fallback_when_directory_missing():
    """Verify fallback to connector_templates.yaml when connector_templates/ is absent."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        config_dir = tmp_path / "platform" / "config"
        config_dir.mkdir(parents=True)
        # Copy real config files EXCEPT connector_templates directory
        real_config = Settings().config_dir
        for f in real_config.iterdir():
            if f.is_file():
                shutil.copy(f, config_dir / f.name)
        capabilities_dir = tmp_path / "platform" / "capabilities"
        shutil.copytree(Settings().content_root / "capabilities", capabilities_dir)
        skills_dir = tmp_path / "platform" / "skills"
        shutil.copytree(Settings().content_root / "skills", skills_dir)

        settings = Settings(
            content_root=tmp_path / "platform",
            config_dir=config_dir,
            projects_root=tmp_path / "projects",
        )
        assert not (config_dir / "connector_templates").exists()
        assert (config_dir / "connector_templates.yaml").exists()

        platform = PlatformConfiguration.load(settings)
        assert len(platform.connector_templates) >= 10
        types = {t.type for t in platform.connector_templates}
        assert "itsm" in types
        assert "log_search" in types


def test_fail_fast_on_malformed_yaml_in_modular_dir():
    """Verify malformed YAML raises ValueError with filename and does not fall back."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        config_dir = tmp_path / "platform" / "config"
        config_dir.mkdir(parents=True)
        real_config = Settings().config_dir
        for f in real_config.iterdir():
            if f.is_file():
                shutil.copy(f, config_dir / f.name)
        shutil.copytree(real_config / "connector_templates", config_dir / "connector_templates")
        capabilities_dir = tmp_path / "platform" / "capabilities"
        shutil.copytree(Settings().content_root / "capabilities", capabilities_dir)
        skills_dir = tmp_path / "platform" / "skills"
        shutil.copytree(Settings().content_root / "skills", skills_dir)

        # Introduce a broken YAML file in modular dir
        broken_file = config_dir / "connector_templates" / "broken.yaml"
        broken_file.write_text("this: is: invalid: [yaml")

        settings = Settings(
            content_root=tmp_path / "platform",
            config_dir=config_dir,
            projects_root=tmp_path / "projects",
        )

        with pytest.raises(ValueError) as exc:
            PlatformConfiguration.load(settings)
        assert "broken.yaml" in str(exc.value)


def test_fail_fast_on_invalid_schema_in_modular_dir():
    """Verify invalid connector template schema raises ValueError with filename."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        config_dir = tmp_path / "platform" / "config"
        config_dir.mkdir(parents=True)
        real_config = Settings().config_dir
        for f in real_config.iterdir():
            if f.is_file():
                shutil.copy(f, config_dir / f.name)
        shutil.copytree(real_config / "connector_templates", config_dir / "connector_templates")
        capabilities_dir = tmp_path / "platform" / "capabilities"
        shutil.copytree(Settings().content_root / "capabilities", capabilities_dir)
        skills_dir = tmp_path / "platform" / "skills"
        shutil.copytree(Settings().content_root / "skills", skills_dir)

        # Introduce an invalid object
        invalid_file = config_dir / "connector_templates" / "invalid.yaml"
        invalid_file.write_text("foo: bar\n")

        settings = Settings(
            content_root=tmp_path / "platform",
            config_dir=config_dir,
            projects_root=tmp_path / "projects",
        )

        with pytest.raises(ValueError) as exc:
            PlatformConfiguration.load(settings)
        assert "invalid.yaml" in str(exc.value)


def test_duplicate_system_name_and_version_rejected():
    """Verify two files defining the same (system_name, version) are rejected."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        config_dir = tmp_path / "platform" / "config"
        config_dir.mkdir(parents=True)
        real_config = Settings().config_dir
        for f in real_config.iterdir():
            if f.is_file():
                shutil.copy(f, config_dir / f.name)
        shutil.copytree(real_config / "connector_templates", config_dir / "connector_templates")
        capabilities_dir = tmp_path / "platform" / "capabilities"
        shutil.copytree(Settings().content_root / "capabilities", capabilities_dir)
        skills_dir = tmp_path / "platform" / "skills"
        shutil.copytree(Settings().content_root / "skills", skills_dir)

        # Duplicate jira.yaml into z_jira_copy.yaml
        jira_content = (config_dir / "connector_templates" / "jira.yaml").read_text()
        (config_dir / "connector_templates" / "z_jira_copy.yaml").write_text(jira_content)

        settings = Settings(
            content_root=tmp_path / "platform",
            config_dir=config_dir,
            projects_root=tmp_path / "projects",
        )

        with pytest.raises(ValueError) as exc:
            PlatformConfiguration.load(settings)
        assert "Duplicate connector template" in str(exc.value)
        assert "z_jira_copy.yaml" in str(exc.value)
