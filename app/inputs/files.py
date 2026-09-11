"""Bounded, local-only extraction for incident attachments."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import mimetypes
import multiprocessing
import os
import subprocess
import shutil
import tempfile
import zipfile
import itertools
from dataclasses import dataclass
from pathlib import PurePath

from app.policy.redaction import redact


@dataclass(frozen=True)
class ParsedFile:
    filename: str
    media_type: str
    text: str
    sha256: str
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class FileLimits:
    max_file_bytes: int = 8 * 1024 * 1024
    max_files: int = 20
    max_expanded_bytes: int = 32 * 1024 * 1024
    max_zip_members: int = 500
    max_pdf_pages: int = 50
    max_rows: int = 2_000
    max_cells: int = 20_000
    max_text_chars: int = 40_000
    max_image_pixels: int = 25_000_000
    parser_timeout_seconds: float = 20.0
    concurrency: int = 4
    allowed_extensions: frozenset[str] = frozenset(
        {
            ".txt",
            ".md",
            ".log",
            ".json",
            ".csv",
            ".tsv",
            ".pdf",
            ".docx",
            ".xlsx",
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
        }
    )

    def __post_init__(self) -> None:
        for name in (
            "max_file_bytes",
            "max_files",
            "max_expanded_bytes",
            "max_zip_members",
            "max_pdf_pages",
            "max_rows",
            "max_cells",
            "max_text_chars",
            "max_image_pixels",
            "concurrency",
        ):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")
        upper = {
            "max_file_bytes": 64 * 1024 * 1024,
            "max_files": 1000,
            "max_expanded_bytes": 256 * 1024 * 1024,
            "max_zip_members": 10_000,
            "max_pdf_pages": 500,
            "max_rows": 100_000,
            "max_cells": 1_000_000,
            "max_text_chars": 1_000_000,
            "max_image_pixels": 100_000_000,
            "concurrency": 32,
        }
        for name, maximum in upper.items():
            if getattr(self, name) > maximum:
                raise ValueError(f"{name} exceeds safety bound")
        if self.parser_timeout_seconds <= 0 or self.parser_timeout_seconds > 120:
            raise ValueError("parser_timeout_seconds must be between 0 and 120")


def _filename(filename: str) -> tuple[str, str]:
    name = PurePath(filename).name
    if not filename or name != filename or name in {".", ".."} or "\x00" in filename:
        raise ValueError("filename must be a plain basename")
    ext = os.path.splitext(name)[1].lower()
    if ext in {
        ".doc",
        ".xls",
        ".ppt",
        ".exe",
        ".dll",
        ".com",
        ".bat",
        ".cmd",
        ".js",
        ".vbs",
    }:
        raise ValueError("legacy or executable file types are not accepted")
    return name, ext


def _zip_limits(data: bytes, ext: str, limits: FileLimits) -> None:
    if ext not in {".docx", ".xlsx"}:
        return
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if (
                len(infos) > limits.max_zip_members
                or sum(max(0, i.file_size) for i in infos) > limits.max_expanded_bytes
            ):
                raise ValueError("archive exceeds extraction limits")
            if any(i.filename.lower().endswith("vbaproject.bin") for i in infos):
                raise ValueError("macro-enabled documents are not accepted")
            if any(
                PurePath(i.filename).suffix.lower()
                in {".exe", ".dll", ".js", ".vbs", ".bat", ".cmd"}
                for i in infos
            ):
                raise ValueError("archive contains an executable member")
    except zipfile.BadZipFile:
        raise ValueError("invalid document archive") from None


def _finish(
    name: str, ext: str, data: bytes, text: str, warnings: list[str], limits: FileLimits
) -> ParsedFile:
    if len(text) > limits.max_text_chars:
        text = text[: limits.max_text_chars]
        warnings.append(f"text truncated at {limits.max_text_chars} characters")
    text = redact(text, max_text=limits.max_text_chars)
    media = {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".log": "text/plain",
        ".json": "application/json",
        ".csv": "text/csv",
        ".tsv": "text/tab-separated-values",
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, mimetypes.guess_type(name)[0] or "application/octet-stream")
    return ParsedFile(
        name, media, text, hashlib.sha256(data).hexdigest(), tuple(warnings)
    )


def _parse_csv(
    data: bytes, delimiter: str, limits: FileLimits
) -> tuple[str, list[str]]:
    warnings: list[str] = []
    rows: list[list[str]] = []
    reader = csv.reader(io.StringIO(data.decode("utf-8-sig")), delimiter=delimiter)
    for row in itertools.islice(reader, limits.max_rows + 1):
        rows.append(row)
    if len(rows) > limits.max_rows:
        rows = rows[: limits.max_rows]
        warnings.append(f"rows truncated at {limits.max_rows}")
    cells = sum(len(row) for row in rows)
    if cells > limits.max_cells:
        kept: list[list[str]] = []
        count = 0
        for row in rows:
            if count + len(row) > limits.max_cells:
                break
            kept.append(row)
            count += len(row)
        rows = kept
        warnings.append(f"cells truncated at {limits.max_cells}")
    return "\n".join(delimiter.join(row) for row in rows), warnings


def _parse_image(data: bytes, ext: str, limits: FileLimits) -> tuple[str, list[str]]:
    try:
        from PIL import Image

        image = Image.open(io.BytesIO(data))
        image.verify()
        image = Image.open(io.BytesIO(data))
    except Exception as exc:
        return "", [f"image decode failed: {type(exc).__name__}"]
    if image.width * image.height > limits.max_image_pixels:
        raise ValueError("image exceeds pixel limit")
    try:
        with tempfile.NamedTemporaryFile(suffix=ext) as handle:
            handle.write(data)
            handle.flush()
            result = subprocess.run(
                [
                    shutil.which("tesseract") or "tesseract",
                    handle.name,
                    "stdout",
                    "-l",
                    "eng",
                ],
                capture_output=True,
                text=True,
                timeout=limits.parser_timeout_seconds,
                check=False,
            )
        if result.returncode != 0:
            return "", ["image OCR unavailable"]
        if not result.stdout.strip():
            return "", ["image OCR produced no text"]
        return result.stdout, []
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return "", ["image OCR unavailable"]


def _parse_file_impl(filename: str, data: bytes, limits: FileLimits) -> ParsedFile:
    """Parse one bounded local file; no network or model calls are made."""
    name, ext = _filename(filename)
    if ext not in limits.allowed_extensions:
        raise ValueError("unsupported file type")
    if len(data) > limits.max_file_bytes:
        raise ValueError("file exceeds 8 MiB limit")
    _zip_limits(data, ext, limits)
    warnings: list[str] = []
    try:
        if ext in {".txt", ".md", ".log"}:
            text = data.decode("utf-8-sig")
        elif ext == ".json":
            text = json.dumps(
                json.loads(data.decode("utf-8-sig")), ensure_ascii=False, indent=2
            )
        elif ext in {".csv", ".tsv"}:
            text, warnings = _parse_csv(data, "\t" if ext == ".tsv" else ",", limits)
        elif ext == ".pdf":
            try:
                from pypdf import PdfReader

                reader = PdfReader(io.BytesIO(data), strict=False)
                if len(reader.pages) > limits.max_pdf_pages:
                    warnings.append(f"pages truncated at {limits.max_pdf_pages}")
                text = "\n".join(
                    (page.extract_text() or "")
                    for page in reader.pages[: limits.max_pdf_pages]
                )
                if not text.strip():
                    warnings.append("scanned PDF OCR unavailable")
            except ImportError:
                text, warnings = "", ["PDF extraction unavailable"]
        elif ext == ".docx":
            try:
                from docx import Document

                doc = Document(io.BytesIO(data))
                parts = [p.text for p in doc.paragraphs]
                for table in doc.tables:
                    parts.extend(
                        "\t".join(cell.text for cell in row.cells) for row in table.rows
                    )
                text = "\n".join(parts)
            except ImportError:
                text, warnings = "", ["DOCX extraction unavailable"]
        elif ext == ".xlsx":
            try:
                import openpyxl

                workbook = openpyxl.load_workbook(
                    io.BytesIO(data), read_only=True, data_only=False, keep_links=False
                )
                rows: list[str] = []
                cells = 0
                for sheet in workbook.worksheets:
                    rows.append(f"[Sheet: {sheet.title}]")
                    for row in sheet.iter_rows():
                        if (
                            len(rows) >= limits.max_rows + 1
                            or cells >= limits.max_cells
                        ):
                            warnings.append("spreadsheet rows/cells truncated")
                            break
                        values = [
                            "" if cell.value is None else str(cell.value)
                            for cell in row
                        ]
                        cells += len(values)
                        rows.append("\t".join(values))
                workbook.close()
                text = "\n".join(rows)
            except ImportError:
                text, warnings = "", ["XLSX extraction unavailable"]
        elif ext in {".png", ".jpg", ".jpeg", ".webp"}:
            text, warnings = _parse_image(data, ext, limits)
        else:
            raise ValueError("unsupported file type")
    except (UnicodeDecodeError, json.JSONDecodeError, csv.Error, ValueError) as exc:
        if isinstance(exc, ValueError) and str(exc) == "unsupported file type":
            raise
        text, warnings = "", [f"file extraction failed: {type(exc).__name__}"]
    return _finish(name, ext, data, text, warnings, limits)


def _parse_worker(connection, filename: str, data: bytes, limits: FileLimits) -> None:
    try:
        connection.send(("ok", _parse_file_impl(filename, data, limits)))
    except BaseException as exc:
        connection.send(("error", type(exc).__name__, str(exc)))
    finally:
        connection.close()


def parse_file(
    filename: str, data: bytes, limits: FileLimits = FileLimits()
) -> ParsedFile:
    """Parse one file in a killable child process with a hard time limit."""
    context = multiprocessing.get_context("spawn")
    parent, child = context.Pipe(duplex=False)
    process = context.Process(
        target=_parse_worker, args=(child, filename, data, limits), daemon=True
    )
    process.start()
    child.close()
    try:
        # Receive before joining: a child can block in Pipe.send() when the
        # bounded result is larger than the OS pipe buffer.
        if not parent.poll(limits.parser_timeout_seconds):
            if process.is_alive():
                process.terminate()
            process.join(2)
            if process.is_alive():
                process.kill()
                process.join(2)
            raise ValueError("file parser exceeded time limit")
        result = parent.recv()
    except (EOFError, OSError):
        raise ValueError("file parser failed") from None
    finally:
        if process.is_alive():
            process.terminate()
        process.join(2)
        if process.is_alive():
            process.kill()
            process.join(2)
        parent.close()
    if result[0] == "ok":
        return result[1]
    raise ValueError(result[2] or "file parser failed")


async def parse_files(
    files: list[tuple[str, bytes]], limits: FileLimits = FileLimits()
) -> list[ParsedFile]:
    """Parse files concurrently with at most four parser workers."""
    if len(files) > limits.max_files:
        raise ValueError(f"at most {limits.max_files} files may be processed")
    semaphore = asyncio.Semaphore(limits.concurrency)

    async def one(filename: str, data: bytes) -> ParsedFile:
        async with semaphore:
            return await asyncio.to_thread(parse_file, filename, data, limits)

    return await asyncio.gather(*(one(filename, data) for filename, data in files))
