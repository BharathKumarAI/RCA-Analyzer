.PHONY: help setup dev test lint eval smoke db-deploy db-migrate docker-up docker-down clean

help:
	@echo "RCA Analyzer commands"
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
