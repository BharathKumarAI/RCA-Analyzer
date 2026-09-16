.PHONY: help setup dev test lint eval smoke db-deploy db-migrate docker-up docker-down clean config-validate config-import config-export config-diff harness-types

help:
	@echo "RCA assist commands"
	@echo "make setup       Install runtime and development dependencies"
	@echo "make dev         Run the local API server"
	@echo "make test        Run the test suite"
	@echo "make lint        Run Ruff"
	@echo "make smoke       Run the platform smoke test"
	@echo "make eval        Run the evaluation script"
	@echo "make db-deploy   Deploy local database schemas and template configuration"
	@echo "make db-migrate  Apply versioned SQL migrations"
	@echo "make docker-up   Start the API and PostgreSQL"
	@echo "make docker-down Stop the API and PostgreSQL"
	@echo "make clean       Remove generated Python caches"
	@echo "make config-validate CONFIG_PATH=... CAPABILITY=... Validate local Harness Studio files"
	@echo "make config-import CONFIG_PATH=... CAPABILITY=... Import a bundle as a reviewable draft"
	@echo "make config-export CAPABILITY=... [DRAFT_ID=...] [OUTPUT=...] Export a workspace bundle"
	@echo "make config-diff CONFIG_PATH=... CAPABILITY=... Compare local files with the remote workspace"
	@echo "make harness-types [HARNESS_SCHEMA=...] Generate frontend workspace contract types"

setup:
	uv sync --locked --extra dev

dev:
	uv run uvicorn app.fast_api_app:app --reload --env-file .env --host 0.0.0.0 --port 8000

test:
	uv run --extra dev python -m pytest -v

lint:
	uv run --extra dev ruff check .

smoke:
	uv run python -m scripts.smoke_test

eval:
	uv run python -m scripts.eval

db-deploy:
	uv run python -m scripts.deploy_local_database

db-migrate:
	uv run python -m scripts.migrate

docker-up: db-deploy
	docker compose up -d --build

docker-down:
	docker compose down

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +

config-validate:
	@test -n "$(CONFIG_PATH)" -a -n "$(CAPABILITY)" || (echo "Usage: make config-validate CONFIG_PATH=... CAPABILITY=..." >&2; exit 2)
	uv run python -m scripts.harness_config validate "$(CONFIG_PATH)" --capability "$(CAPABILITY)"

config-import:
	@test -n "$(CONFIG_PATH)" -a -n "$(CAPABILITY)" || (echo "Usage: make config-import CONFIG_PATH=... CAPABILITY=..." >&2; exit 2)
	uv run python -m scripts.harness_config import "$(CONFIG_PATH)" --capability "$(CAPABILITY)"

config-export:
	@test -n "$(CAPABILITY)" || (echo "Usage: make config-export CAPABILITY=... [DRAFT_ID=...] [OUTPUT=...]" >&2; exit 2)
	uv run python -m scripts.harness_config export --capability "$(CAPABILITY)" $(if $(DRAFT_ID),--draft-id "$(DRAFT_ID)",) $(if $(OUTPUT),--output "$(OUTPUT)",)

config-diff:
	@test -n "$(CONFIG_PATH)" -a -n "$(CAPABILITY)" || (echo "Usage: make config-diff CONFIG_PATH=... CAPABILITY=..." >&2; exit 2)
	uv run python -m scripts.harness_config diff "$(CONFIG_PATH)" --capability "$(CAPABILITY)"

harness-types:
	@if test -n "$(HARNESS_SCHEMA)"; then \
		uv run python -m scripts.generate_harness_types --schema "$(HARNESS_SCHEMA)"; \
	else \
		uv run python -m scripts.generate_harness_types --api-url "$${RCA_API_URL:-http://127.0.0.1:8000}"; \
	fi
