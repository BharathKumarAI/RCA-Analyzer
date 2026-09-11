"""Configure and deploy only this repository's local Compose PostgreSQL service."""

import argparse
import os
from pathlib import Path
import re
import secrets
import subprocess

from dotenv import dotenv_values, set_key
from sqlalchemy.engine import URL, make_url

ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    return subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Drop and recreate only this Compose application's database; blob files are retained",
    )
    args = parser.parse_args()
    path = ROOT / ".env"
    path.touch(mode=0o600, exist_ok=True)
    values = dict(dotenv_values(path))
    user = values.get("POSTGRES_USER") or "app_admin"
    database = values.get("POSTGRES_DB") or "rca_db"
    if not all(
        re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", item) for item in (user, database)
    ):
        raise ValueError(
            "Local database and owner names must be simple SQL identifiers"
        )
    port = int(values.get("POSTGRES_PORT") or 5432)
    if not 1024 <= port <= 65535:
        raise ValueError("Invalid local PostgreSQL port")
    password = values.get("POSTGRES_PASSWORD")
    if not password or password == "change-me":
        password = secrets.token_hex(24)
    app_password = values.get("RCA_APP_DATABASE_PASSWORD") or secrets.token_hex(24)

    def url(username, secret):
        return URL.create(
            "postgresql+asyncpg",
            username=username,
            password=secret,
            host="127.0.0.1",
            port=port,
            database=database,
        ).render_as_string(hide_password=False)

    app_url = make_url(url("rca_app", app_password))
    tracking_url = app_url.set(
        drivername="postgresql+psycopg", query={"options": "-csearch_path=mlflow"}
    )
    updates = {
        "POSTGRES_USER": user,
        "POSTGRES_DB": database,
        "POSTGRES_PORT": str(port),
        "POSTGRES_PASSWORD": password,
        "RCA_APP_DATABASE_PASSWORD": app_password,
        "RCA_DATABASE_URL": url("rca_app", app_password),
        "RCA_SESSION_DATABASE_URL": url("rca_app", app_password),
        "RCA_MIGRATION_DATABASE_URL": url(user, password),
        "RCA_DOCKER_DATABASE_URL": app_url.set(
            host="postgres", port=5432
        ).render_as_string(hide_password=False),
        "RCA_OPTIMIZATION_TRACKING_URI": tracking_url.render_as_string(
            hide_password=False
        ),
        "RCA_DOCKER_TRACKING_URI": tracking_url.set(
            host="postgres", port=5432
        ).render_as_string(hide_password=False),
        "RCA_DATABASE_CONFIGURATION": "true",
        "RCA_MODE": values.get("RCA_MODE") or "demo",
        "RCA_TENANT_ID": values.get("RCA_TENANT_ID") or "acme",
        "RCA_PROJECT_ID": values.get("RCA_PROJECT_ID") or "payments-prod",
        "RCA_PROJECT_NAME": values.get("RCA_PROJECT_NAME") or "Payments (local)",
    }
    # Preserve every unrelated setting and credential. Never print secret values.
    for key, value in updates.items():
        set_key(path, key, value)
    path.chmod(0o600)
    values.update(updates)
    runtime = ROOT / ".env.runtime"
    runtime.touch(mode=0o600, exist_ok=True)
    # No owner password or migration URL enters the API container.
    runtime.write_text("", encoding="utf-8")
    for key, value in values.items():
        if (
            value is not None
            and not key.startswith("POSTGRES_")
            and key not in {"RCA_APP_DATABASE_PASSWORD", "RCA_MIGRATION_DATABASE_URL"}
        ):
            set_key(runtime, key, value)
    runtime.chmod(0o600)
    run("docker", "compose", "up", "-d", "--wait", "postgres")
    # Local in-container administrator connection also updates an existing volume
    # that was initialized by an older Compose file with its example password.
    from sqlalchemy import literal
    from sqlalchemy.dialects import postgresql

    quoted = str(
        literal(password).compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    run(
        "docker",
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        user,
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        input=f'ALTER ROLE "{user}" PASSWORD {quoted};',
        text=True,
        stdout=subprocess.DEVNULL,
    )
    if args.recreate:
        run("docker", "compose", "stop", "api")
        run(
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            user,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            input=f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);\nCREATE DATABASE "{database}" OWNER "{user}";',
            text=True,
            stdout=subprocess.DEVNULL,
        )
        print("Recreated the repository database; blob files were retained")
    env = os.environ | {
        key: value for key, value in values.items() if value is not None
    }
    import sys

    run(sys.executable, "-m", "scripts.deploy_database", env=env)
    print(
        "Local PostgreSQL configured; credentials are stored in .env and .env.runtime"
    )


if __name__ == "__main__":
    main()
