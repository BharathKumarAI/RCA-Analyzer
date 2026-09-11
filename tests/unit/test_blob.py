import hashlib
import tempfile
import unittest
from pathlib import Path

from app.connectors.providers.blob import ConfigurationBlobStore


class ConfigurationBlobStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_put_get_is_content_addressed_and_immutable(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ConfigurationBlobStore(directory)
            data = b"id: example\n"
            digest = await store.put(data)
            self.assertEqual(digest, "sha256:" + hashlib.sha256(data).hexdigest())
            self.assertEqual(await store.get(digest), data)
            self.assertEqual(await store.put(data), digest)
            path = Path(directory) / (digest.removeprefix("sha256:") + ".yaml")
            path.write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                await store.get(digest)

    async def test_rejects_invalid_hash_and_oversize_content(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ConfigurationBlobStore(directory, max_bytes=4)
            with self.assertRaises(ValueError):
                await store.put(b"12345")
            with self.assertRaises(ValueError):
                await store.get("../../etc/passwd")


if __name__ == "__main__":
    unittest.main()
