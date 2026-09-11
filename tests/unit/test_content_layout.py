"""A complete platform content bundle can be loaded from a different mount."""

import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import yaml
from fastapi.testclient import TestClient
from app.fast_api_app import create_app
from app.settings import CONTENT_ROOT, Settings


class ContentLayoutTests(unittest.TestCase):
    def test_relocated_bundle_controls_config_capabilities_and_skills(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            bundle = root / "mounted" / "platform"
            shutil.copytree(CONTENT_ROOT, bundle)
            path = bundle / "config" / "model_profiles.yaml"
            profiles = yaml.safe_load(path.read_text())
            profiles["stages"]["triage"]["temperature"] = 0.4
            path.write_text(yaml.safe_dump(profiles))
            with patch.dict(os.environ, {"RCA_CONTENT_ROOT": str(bundle)}, clear=True):
                settings = Settings.from_env()
            self.assertEqual(settings.config_dir, bundle / "config")
            settings = settings.model_copy(
                update={
                    "database_url": Settings(
                        database_url=f"sqlite+aiosqlite:///{root / 'runs.db'}"
                    ).database_url,
                    "session_database_url": Settings(
                        session_database_url=f"sqlite+aiosqlite:///{root / 'sessions.db'}"
                    ).session_database_url,
                    "config_blob_uri": str(root / "agent-configurations"),
                }
            )
            with TestClient(create_app(settings)) as client:
                self.assertEqual(client.get("/health").status_code, 200)
                self.assertEqual(
                    client.app.state.registry.manifests_dir, bundle / "capabilities"
                )
                self.assertIn(
                    "incident-triage", client.app.state.registry.skill_contents
                )
                self.assertEqual(
                    client.app.state.runner.profiles.stages["triage"].temperature, 0.4
                )
