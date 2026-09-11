"""Slow authenticated bodies must not hold upload capacity indefinitely."""

import asyncio
import tempfile
import unittest

import httpx

from app.api.application import create_app
from tests.support import settings_for


class RequestBodyTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_bodies_time_out_and_release_upload_capacity(self):
        with tempfile.TemporaryDirectory() as directory:
            settings, token = settings_for(directory)
            # Shorten only the test deadline; production settings require >= 1s.
            settings = settings.model_copy(
                update={"run_timeout_seconds": 0.02, "max_concurrent_uploads": 1}
            )
            app = create_app(settings)
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://test"
                ) as client:
                    for path in ("/api/v1/files", "/api/v1/runs"):
                        with self.subTest(path=path):
                            async def slow_body():
                                yield b"partial"
                                await asyncio.Event().wait()

                            response = await asyncio.wait_for(
                                client.post(path, headers=token(), content=slow_body()),
                                timeout=2,
                            )
                            self.assertEqual(response.status_code, 408, response.text)
                            self.assertFalse(app.state.upload_limiter.locked())
                    response = await client.post(
                        "/api/v1/files",
                        headers=token(),
                        files={"files": ("incident.txt", b"DNS failed", "text/plain")},
                    )
                    self.assertEqual(response.status_code, 201, response.text)
                    response = await client.post(
                        "/api/v1/runs", content=b"ignored", headers={}
                    )
                    self.assertEqual(response.status_code, 401, response.text)
