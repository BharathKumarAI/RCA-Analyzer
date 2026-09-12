"""Generate TypeScript declarations from the Harness Workspace JSON Schema.

The schema can be a local JSON Schema document or the API's OpenAPI document.
When no local schema is supplied, the script discovers the workspace response
schema from ``RCA_API_URL``. This keeps the frontend contract tied to the
Pydantic response model without importing backend code into the generator.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import httpx2


DEFAULT_OUTPUT = "frontend/src/features/harness-studio/types/workspace.generated.ts"
DEFAULT_MODEL = "Workspace"


class TypeGenerationError(RuntimeError):
    pass


def _api_url(value: str | None) -> str:
    return (value or os.environ.get("RCA_API_URL") or "http://127.0.0.1:8000").rstrip("/")


def _token() -> str | None:
    return (os.environ.get("RCA_API_TOKEN") or os.environ.get("RCA_TOKEN") or "").strip() or None


def load_document(args: argparse.Namespace) -> dict[str, Any]:
    if args.schema:
        path = Path(args.schema)
        if not path.is_file():
            raise TypeGenerationError(f"Schema file does not exist: {path}")
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise TypeGenerationError(f"Unable to read JSON schema: {path}") from exc
    url = f"{_api_url(args.api_url)}/openapi.json"
    headers = {"Accept": "application/json"}
    if token := _token():
        headers["Authorization"] = f"Bearer {token}"
    try:
        response = httpx2.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except httpx2.HTTPError as exc:
        raise TypeGenerationError(f"Unable to fetch OpenAPI schema ({exc.__class__.__name__})") from None
    except ValueError:
        raise TypeGenerationError("OpenAPI endpoint returned invalid JSON") from None


def workspace_schema(document: dict[str, Any], model: str) -> tuple[str, dict[str, Any], dict[str, Any]]:
    if "openapi" not in document and "swagger" not in document:
        definitions = document.get("$defs") or document.get("definitions") or {}
        return model, document, definitions
    schemas = document.get("components", {}).get("schemas", {})
    if model in schemas:
        return model, schemas[model], schemas
    operation = document.get("paths", {}).get("/api/v1/harness/workspace", {}).get("get", {})
    response = operation.get("responses", {}).get("200", {})
    ref = response.get("content", {}).get("application/json", {}).get("schema", {}).get("$ref", "")
    name = ref.rsplit("/", 1)[-1] if ref else ""
    if name in schemas:
        return name, schemas[name], schemas
    raise TypeGenerationError(f"OpenAPI does not define a workspace response schema ({model})")


def type_name(value: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", value)
    name = "".join(word[:1].upper() + word[1:] for word in words) or "GeneratedType"
    return name if name[0].isalpha() else f"Type{name}"


class TypeScriptGenerator:
    def __init__(self, root_name: str, root: dict[str, Any], known_schemas: dict[str, Any] | None = None) -> None:
        self.root_name = type_name(root_name)
        self.root = root
        self.definitions: dict[str, dict[str, Any]] = {
            type_name(name): schema for name, schema in (known_schemas or {}).items()
            if isinstance(schema, dict)
        }
        self.names: dict[str, str] = {}

    def ref_name(self, ref: str) -> str:
        return type_name(ref.rsplit("/", 1)[-1])

    def render_type(self, schema: Any, hint: str = "Value") -> str:
        if not isinstance(schema, dict):
            return "unknown"
        if "$ref" in schema:
            return self.ref_name(schema["$ref"])
        if "const" in schema:
            return json.dumps(schema["const"])
        if "enum" in schema:
            return " | ".join(json.dumps(value) for value in schema["enum"])
        for key in ("oneOf", "anyOf"):
            if key in schema:
                values = [self.render_type(item, hint) for item in schema[key]]
                return " | ".join(dict.fromkeys(values)) or "unknown"
        if "allOf" in schema:
            values = [self.render_type(item, hint) for item in schema["allOf"]]
            return " & ".join(dict.fromkeys(values)) or "unknown"
        schema_type = schema.get("type")
        if schema_type == "array":
            return f"Array<{self.render_type(schema.get('items', {}), hint + 'Item')}>"
        if schema_type == "object" or "properties" in schema or "additionalProperties" in schema:
            return self.object_type(schema, hint)
        return {"string": "string", "integer": "number", "number": "number", "boolean": "boolean", "null": "null"}.get(schema_type, "unknown")

    def object_type(self, schema: dict[str, Any], hint: str) -> str:
        if not schema.get("properties"):
            additional = schema.get("additionalProperties")
            return f"Record<string, {self.render_type(additional, hint + 'Value') if isinstance(additional, dict) else 'unknown'}>"
        name = type_name(hint)
        self.names.setdefault(name, name)
        self.definitions.setdefault(name, schema)
        return name

    def render_interface(self, name: str, schema: dict[str, Any]) -> str:
        required = set(schema.get("required", []))
        lines = [f"export interface {name} {{"]
        for field, value in schema.get("properties", {}).items():
            optional = "" if field in required else "?"
            field_name = field if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", field) else json.dumps(field)
            lines.append(f"  {field_name}{optional}: {self.render_type(value, type_name(field))};")
        lines.append("}")
        return "\n".join(lines)

    def generate(self) -> str:
        self.definitions[self.root_name] = self.root
        pending = [self.root_name]
        rendered: list[str] = []
        while pending:
            name = pending.pop(0)
            schema = self.definitions[name]
            rendered.append(self.render_interface(name, schema))
            for child_name in self.names:
                if child_name not in {self.root_name, *[item.split("\n", 1)[0] for item in rendered]} and child_name in self.definitions:
                    pending.append(child_name)
        # Definitions discovered while rendering are emitted once, in discovery order.
        known: set[str] = set()
        output: list[str] = []
        for block in rendered:
            title = block.split(" ", 3)[2] if block.startswith("export interface ") else ""
            if title and title not in known:
                output.append(block)
                known.add(title)
        for name, schema in self.definitions.items():
            if name not in known:
                output.append(self.render_interface(name, schema))
                known.add(name)
        return "// Generated by scripts/generate_harness_types.py; do not edit.\n\n" + "\n\n".join(output) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", help="Local JSON Schema or OpenAPI JSON file")
    parser.add_argument("--api-url", help="API base URL used to fetch /openapi.json")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="OpenAPI component name")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        document = load_document(args)
        name, schema, known_schemas = workspace_schema(document, args.model)
        output = TypeScriptGenerator(name, schema, known_schemas).generate()
        destination = Path(args.output)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(output, encoding="utf-8")
    except TypeGenerationError as exc:
        print(f"generate-harness-types: {exc}", file=sys.stderr)
        return 2
    print(f"Generated {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
