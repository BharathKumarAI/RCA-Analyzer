"""Unit tests for bounded local file parsing."""

import asyncio
import io
import unittest
import zipfile

from PIL import Image

from app.inputs.files import FileLimits, parse_file, parse_files


class FileParsingTests(unittest.TestCase):
    def test_text_is_hashed_and_redacted(self):
        parsed = parse_file("incident.txt", b"owner=a@example.com token=secret")
        self.assertEqual(parsed.filename, "incident.txt")
        self.assertEqual(parsed.media_type, "text/plain")
        self.assertIn("[EMAIL]", parsed.text)
        self.assertIn("[REDACTED]", parsed.text)
        self.assertEqual(len(parsed.sha256), 64)

    def test_csv_and_json_are_bounded(self):
        csv_file = parse_file("events.csv", b"a,b\n1,2\n3,4\n", FileLimits(max_rows=2))
        self.assertIn("rows truncated", " ".join(csv_file.warnings))
        json_file = parse_file("event.json", b'{"password":"hidden","ok":true}')
        self.assertIn("[REDACTED]", json_file.text)

    def test_image_decode_and_ocr_failure_is_explicit(self):
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2), "white").save(buffer, format="PNG")
        parsed = parse_file("screenshot.png", buffer.getvalue())
        self.assertEqual(parsed.media_type, "image/png")
        self.assertTrue(parsed.text or parsed.warnings)

    def test_filename_and_size_limits(self):
        with self.assertRaises(ValueError):
            parse_file("../secret.txt", b"x")
        with self.assertRaises(ValueError):
            parse_file("big.txt", b"x" * 9, FileLimits(max_file_bytes=8))
        with self.assertRaises(ValueError):
            parse_file("old.xls", b"x")

    def test_parser_has_hard_timeout(self):
        with self.assertRaises(ValueError):
            parse_file("slow.txt", b"x", FileLimits(parser_timeout_seconds=0.001))

    def test_large_bounded_result_is_received_before_child_join(self):
        parsed = parse_file(
            "long.txt", b"x" * 100_000, FileLimits(max_text_chars=90_000)
        )
        self.assertEqual(len(parsed.text), 90_000)
        self.assertTrue(parsed.warnings)

    def test_malformed_and_bomb_archives_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_file("bad.docx", b"not a zip")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("word/document.xml", b"x" * 20)
        with self.assertRaises(ValueError):
            parse_file(
                "large.docx", buffer.getvalue(), FileLimits(max_expanded_bytes=10)
            )

    def test_parallel_parser_preserves_order_and_file_count_bound(self):
        async def run():
            return await parse_files(
                [("a.txt", b"a"), ("b.md", b"b")], FileLimits(concurrency=1)
            )

        result = asyncio.run(run())
        self.assertEqual([item.filename for item in result], ["a.txt", "b.md"])
        with self.assertRaises(ValueError):
            asyncio.run(
                parse_files([("a.txt", b"a"), ("b.md", b"b")], FileLimits(max_files=1))
            )


if __name__ == "__main__":
    unittest.main()
