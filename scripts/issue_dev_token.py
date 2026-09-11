"""Development-only RS256 token issuer for configured demo principals.

Requires an explicit private key file path. Refuses to run if RCA_MODE is not 'demo'.
Never generates or commits private keys.
"""

import argparse
import os
import sys
import time
from pathlib import Path

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from dotenv import load_dotenv

from app.settings import Settings

load_dotenv()


def issue_token(
    subject: str,
    key_path: str | Path,
    expires_in: int = 3600,
    settings: Settings | None = None,
) -> str:
    settings = settings or Settings.from_env()
    if settings.mode != "demo":
        raise PermissionError(
            "issue_dev_token is restricted to RCA_MODE=demo deployments"
        )
    if not settings.auth_issuer or not settings.auth_audience:
        raise ValueError("Deployment auth_issuer and auth_audience must be configured")
    if subject not in settings.principals:
        raise KeyError(
            f"Subject '{subject}' is not in configured principals: {list(settings.principals.keys())}"
        )

    key_file = Path(key_path).expanduser().resolve()
    if not key_file.is_file():
        raise FileNotFoundError(f"Private key file not found: {key_file}")

    private_key_data = key_file.read_bytes()
    private_key = load_pem_private_key(private_key_data, password=None)

    now = int(time.time())
    claims = {
        "iss": settings.auth_issuer,
        "aud": settings.auth_audience,
        "sub": subject,
        "iat": now,
        "exp": now + expires_in,
    }
    return jwt.encode(claims, private_key, algorithm="RS256")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Issue development RS256 JWT for a configured principal in demo mode."
    )
    parser.add_argument(
        "subject",
        help="Configured subject/principal username (e.g. analyst, admin, owner)",
    )
    parser.add_argument(
        "--key-path",
        default=os.getenv("RCA_DEV_AUTH_PRIVATE_KEY_PATH"),
        help="Path to RSA private key PEM file (defaults to RCA_DEV_AUTH_PRIVATE_KEY_PATH)",
    )
    parser.add_argument(
        "--expires-in",
        type=int,
        default=3600,
        help="Token lifetime in seconds (default: 3600)",
    )
    parser.add_argument(
        "--header",
        action="store_true",
        help="Output with 'Authorization: Bearer ' prefix",
    )

    args = parser.parse_args()
    if not args.key_path:
        sys.stderr.write(
            "Error: --key-path or RCA_DEV_AUTH_PRIVATE_KEY_PATH environment variable is required.\n"
        )
        sys.exit(1)

    try:
        token = issue_token(args.subject, args.key_path, expires_in=args.expires_in)
        if args.header:
            print(f"Authorization: Bearer {token}")
        else:
            print(token)
    except Exception as exc:
        sys.stderr.write(f"Error: {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
