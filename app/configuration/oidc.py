"""Reviewed OIDC settings and database-owned one-use login/browser sessions."""

import base64
import hashlib
import hmac
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from typing import Literal
from urllib.parse import urlsplit, urlencode

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import Column, Float, MetaData, String, Table, delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError, OperationalError

from app.configuration.parameters import system_configurations, audit
from app.connectors.providers.oidc import OidcProvider
from app.identity.principals import Role
from app.persistence.database import initialize_tables, scoped_engine
from app.runtime.run_contract import content_hash

SESSION_COOKIE = "__Host-rca_session"
CSRF_COOKIE = "__Host-rca_csrf"
LOGIN_COOKIE = "__Host-rca_oidc"


class OidcConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    display_name: str = Field(min_length=1, max_length=80)
    issuer: str = Field(max_length=2048)
    client_id: str = Field(min_length=1, max_length=256)
    authorization_endpoint: str = Field(max_length=2048)
    token_endpoint: str = Field(max_length=2048)
    jwks_uri: str = Field(max_length=2048)
    redirect_uri: str = Field(max_length=2048)
    token_auth_method: Literal["client_secret_basic", "client_secret_post", "none"] = "client_secret_basic"
    client_secret_reference: str = Field(default="", pattern=r"^(env://[A-Z][A-Z0-9_]{0,127})?$")
    scopes: tuple[Literal["openid", "profile", "email"], ...] = ("openid",)
    session_ttl_seconds: int = Field(default=3600, ge=300, le=28800)
    max_pending_logins: int = Field(default=1000, ge=10, le=10000)

    @field_validator("display_name", "client_id")
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError("A nonblank value is required")
        return value.strip()

    @field_validator("issuer", "authorization_endpoint", "token_endpoint", "jwks_uri", "redirect_uri")
    @classmethod
    def https_endpoint(cls, value):
        parts = urlsplit(value)
        if (parts.scheme != "https" or not parts.hostname or parts.username or parts.password
                or parts.query or parts.fragment or any(char.isspace() for char in value)):
            raise ValueError("Identity endpoints must be explicit HTTPS URLs without credentials, queries, or fragments")
        return value

    @model_validator(mode="after")
    def protocol_contract(self):
        if "openid" not in self.scopes or len(set(self.scopes)) != len(self.scopes):
            raise ValueError("Scopes must be unique and include openid")
        if (self.token_auth_method == "none") == bool(self.client_secret_reference):
            raise ValueError("Confidential clients require an env:// secret reference; public clients must omit it")
        if urlsplit(self.redirect_uri).path != "/api/v1/auth/callback":
            raise ValueError("The redirect URI must end with /api/v1/auth/callback")
        return self

    @property
    def origin(self):
        url = urlsplit(self.redirect_uri)
        return f"{url.scheme}://{url.netloc}"


class OidcRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    draft_id: str
    definition: OidcConfiguration
    status: Literal["PENDING", "APPROVED", "REJECTED", "REVOKED", "SUPERSEDED"]
    content_hash: str
    author_subject: str
    project_id: str
    created_at: float
    reviewer_subject: str | None = None
    reviewed_at: float | None = None
    review_reason: str | None = None


metadata = MetaData(schema="runtime")
login_transactions = Table("oidc_login_transactions", metadata,
    Column("state_hash", String(64), primary_key=True),
    Column("tenant_id", String(256), nullable=False), Column("project_id", String(256), nullable=False),
    Column("browser_hash", String(64), nullable=False), Column("nonce_hash", String(64), nullable=False),
    Column("code_verifier", String(128), nullable=False), Column("configuration_hash", String(128), nullable=False),
    Column("expires_at", Float, nullable=False, index=True))
browser_sessions = Table("browser_sessions", metadata,
    Column("session_hash", String(64), primary_key=True),
    Column("tenant_id", String(256), nullable=False), Column("project_id", String(256), nullable=False),
    Column("subject", String(256), nullable=False), Column("issuer", String(2048), nullable=False),
    Column("configuration_hash", String(128), nullable=False), Column("csrf_hash", String(64), nullable=False),
    Column("created_at", Float, nullable=False), Column("expires_at", Float, nullable=False, index=True))


def token_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def approval_hash(record):
    # A reapproved identical definition is a new authorization. Sessions and
    # pending logins from a revoked/superseded approval must never revive.
    return content_hash({"draft_id": record.draft_id, "content_hash": record.content_hash})


class OidcConflict(ValueError):
    pass


class OidcCapacity(ValueError):
    pass


class OidcService:
    def __init__(self, engine, settings, provider=None):
        self.engine, self.settings = scoped_engine(engine), settings
        self.provider = provider or OidcProvider()

    async def initialize(self):
        await initialize_tables(self.engine, metadata)

    async def aclose(self):
        await self.provider.aclose()

    def _storage_key(self, key):
        # A tenant may host several deployments with different callback origins.
        # Hashing the project keeps the existing 128-character catalog key bound.
        return token_hash(self.settings.project_id) + ":" + key

    def _key(self, key):
        return (system_configurations.c.tenant_id == self.settings.tenant_id,
                system_configurations.c.config_type == "oidc", system_configurations.c.config_key == self._storage_key(key))

    def _scope(self, table):
        return (table.c.tenant_id == self.settings.tenant_id, table.c.project_id == self.settings.project_id)

    @staticmethod
    def _record(data):
        record = OidcRecord.model_validate(data)
        if record.content_hash != content_hash(record.definition.model_dump(mode="json")):
            raise ValueError("Sign-in configuration failed integrity verification")
        return record

    async def active(self, connection=None):
        if connection is None:
            async with self.engine.connect() as connection:
                return await self.active(connection)
        pointer = await connection.scalar(select(system_configurations.c.content_json).where(*self._key("active")))
        if not pointer or not pointer.get("draft_id"):
            return None
        data = await connection.scalar(select(system_configurations.c.content_json).where(*self._key(pointer["draft_id"])))
        record = self._record(data) if data else None
        if not record or record.status != "APPROVED":
            raise ValueError("Active sign-in configuration is unavailable")
        return record

    async def catalog(self):
        async with self.engine.connect() as connection:
            rows = await connection.scalars(select(system_configurations.c.content_json).where(
                system_configurations.c.tenant_id == self.settings.tenant_id,
                system_configurations.c.config_type == "oidc",
                system_configurations.c.config_key.startswith(self._storage_key("")),
                system_configurations.c.config_key != self._storage_key("active"),
            ).order_by(system_configurations.c.updated_at.desc()).limit(100))
            return {"active": await self.active(connection), "drafts": [self._record(row) for row in rows]}

    async def _audit(self, connection, principal, record, action):
        await connection.execute(insert(audit).values(tenant_id=principal.tenant_id, project_id=principal.project_id,
            tool="identity", variable_name=record.draft_id, actor_subject=principal.subject, action=action,
            revision=1, created_at=time.time(), details={"content_hash": record.content_hash, "reason": record.review_reason}))

    def _admin(self, principal):
        if (Role.PLATFORM_ADMIN not in principal.roles or principal.tenant_id != self.settings.tenant_id
                or principal.project_id != self.settings.project_id):
            raise PermissionError("Sign-in settings require a platform administrator in this deployment scope")

    async def submit(self, principal, definition):
        self._admin(principal)
        record = OidcRecord(draft_id="oidc_" + uuid.uuid4().hex, definition=definition, status="PENDING",
            content_hash=content_hash(definition.model_dump(mode="json")), author_subject=principal.subject,
            project_id=principal.project_id, created_at=time.time())
        async with self.engine.begin() as connection:
            await connection.execute(insert(system_configurations).values(tenant_id=principal.tenant_id,
                config_type="oidc", config_key=self._storage_key(record.draft_id), content_json=record.model_dump(mode="json"),
                revision=1, updated_at=record.created_at))
            await self._audit(connection, principal, record, "submit")
        return record

    @asynccontextmanager
    async def _configuration_transaction(self):
        try:
            async with self.engine.begin() as connection:
                revision = await connection.scalar(select(system_configurations.c.revision).where(*self._key("active")))
                if revision is None:
                    await connection.execute(insert(system_configurations).values(tenant_id=self.settings.tenant_id,
                        config_type="oidc", config_key=self._storage_key("active"), content_json={}, revision=1, updated_at=time.time()))
                else:
                    locked = await connection.execute(update(system_configurations).where(*self._key("active"),
                        system_configurations.c.revision == revision).values(revision=revision + 1, updated_at=time.time()))
                    if locked.rowcount != 1:
                        raise OidcConflict("Active sign-in settings changed. Reload before reviewing.")
                yield connection
        except IntegrityError:
            raise OidcConflict("Active sign-in settings changed. Reload before reviewing.") from None
        except OperationalError as exc:
            if "locked" in str(exc.orig).lower() or "busy" in str(exc.orig).lower():
                raise OidcConflict("Sign-in settings are being reviewed. Reload before trying again.") from None
            raise

    async def review(self, principal, draft_id, action, expected_hash, reason):
        self._admin(principal)
        try:
            async with self._configuration_transaction() as connection:
                row = (await connection.execute(select(system_configurations).where(*self._key(draft_id)).with_for_update())).first()
                if row is None:
                    raise LookupError("Sign-in configuration was not found")
                record = self._record(row.content_json)
                if record.project_id != principal.project_id:
                    raise PermissionError("Review requires the author's project scope")
                if action != "revoke" and record.author_subject == principal.subject:
                    raise PermissionError("A different administrator must review this configuration")
                required = "APPROVED" if action == "revoke" else "PENDING"
                if record.content_hash != expected_hash or record.status != required:
                    raise OidcConflict("Sign-in configuration or review state changed. Reload before reviewing.")
                updated = record.model_copy(update={"status": {"approve": "APPROVED", "reject": "REJECTED", "revoke": "REVOKED"}[action],
                    "reviewer_subject": principal.subject, "reviewed_at": time.time(), "review_reason": reason})
                current = await self.active(connection)
                changed = await connection.execute(update(system_configurations).where(*self._key(draft_id),
                    system_configurations.c.revision == row.revision).values(content_json=updated.model_dump(mode="json"),
                        revision=row.revision + 1, updated_at=updated.reviewed_at))
                if changed.rowcount != 1:
                    raise OidcConflict("Sign-in configuration changed. Reload before reviewing.")
                if action == "approve":
                    if current and current.draft_id != draft_id:
                        previous = current.model_copy(update={"status": "SUPERSEDED"})
                        await connection.execute(update(system_configurations).where(*self._key(current.draft_id)).values(
                            content_json=previous.model_dump(mode="json"), revision=system_configurations.c.revision + 1,
                            updated_at=updated.reviewed_at))
                    pointer = {"draft_id": draft_id}
                    previous_pointer = await connection.scalar(select(system_configurations.c.revision).where(*self._key("active")))
                    if previous_pointer is None:
                        await connection.execute(insert(system_configurations).values(tenant_id=principal.tenant_id,
                            config_type="oidc", config_key=self._storage_key("active"), content_json=pointer, revision=1, updated_at=time.time()))
                    else:
                        result = await connection.execute(update(system_configurations).where(*self._key("active"),
                            system_configurations.c.revision == previous_pointer).values(content_json=pointer,
                                revision=previous_pointer + 1, updated_at=time.time()))
                        if result.rowcount != 1:
                            raise OidcConflict("Active sign-in settings changed. Reload before reviewing.")
                elif action == "revoke" and current and current.draft_id == draft_id:
                    await connection.execute(update(system_configurations).where(*self._key("active")).values(
                        content_json={}, revision=system_configurations.c.revision + 1, updated_at=time.time()))
                await self._audit(connection, principal, updated, action)
        except IntegrityError:
            raise OidcConflict("Active sign-in settings changed. Reload before reviewing.") from None
        return updated

    async def begin_login(self):
        state, browser, nonce, verifier = (secrets.token_urlsafe(size) for size in (32, 32, 32, 64))
        # Serialize the capacity check and insertion across workers using the same
        # database lock as provider review. The active definition stays unchanged.
        async with self._configuration_transaction() as connection:
            record = await self.active(connection)
            if record is None:
                raise LookupError("Single sign-on is not configured")
            await connection.execute(delete(login_transactions).where(*self._scope(login_transactions), login_transactions.c.expires_at <= time.time()))
            await connection.execute(delete(browser_sessions).where(*self._scope(browser_sessions), browser_sessions.c.expires_at <= time.time()))
            pending = await connection.scalar(select(func.count()).select_from(login_transactions).where(*self._scope(login_transactions)))
            if pending >= record.definition.max_pending_logins:
                raise OidcCapacity("Sign-in capacity reached. Please try again shortly.")
            await connection.execute(insert(login_transactions).values(state_hash=token_hash(state),
                tenant_id=self.settings.tenant_id, project_id=self.settings.project_id, browser_hash=token_hash(browser),
                nonce_hash=token_hash(nonce), code_verifier=verifier, configuration_hash=approval_hash(record),
                expires_at=time.time() + 300))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        query = urlencode({"client_id": record.definition.client_id, "response_type": "code",
            "redirect_uri": record.definition.redirect_uri, "scope": " ".join(record.definition.scopes),
            "state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256"})
        return record.definition.authorization_endpoint + "?" + query, browser

    async def consume_login(self, state, browser, code):
        if not state or not browser or not code or max(len(state), len(browser), len(code)) > 4096:
            raise ValueError("Sign-in response is incomplete")
        async with self.engine.begin() as connection:
            transaction = (await connection.execute(delete(login_transactions).where(*self._scope(login_transactions),
                login_transactions.c.state_hash == token_hash(state), login_transactions.c.browser_hash == token_hash(browser),
                login_transactions.c.expires_at > time.time()).returning(login_transactions))).first()
        if transaction is None:
            raise ValueError("Sign-in request expired or was already used")
        record = await self.active()
        if record is None or approval_hash(record) != transaction.configuration_hash:
            raise ValueError("Sign-in settings changed. Start a new sign-in request.")
        claims = await self.provider.exchange(record.definition, code, transaction.code_verifier, transaction.nonce_hash)
        return record, claims

    async def create_session(self, record, principal, claims):
        session, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        expires = min(float(claims["exp"]), time.time() + record.definition.session_ttl_seconds)
        if expires <= time.time():
            raise ValueError("Identity session has expired")
        async with self.engine.begin() as connection:
            await connection.execute(insert(browser_sessions).values(session_hash=token_hash(session),
                tenant_id=self.settings.tenant_id, project_id=self.settings.project_id, subject=principal.subject,
                issuer=record.definition.issuer, configuration_hash=approval_hash(record), csrf_hash=token_hash(csrf),
                created_at=time.time(), expires_at=expires))
        return session, csrf, expires

    async def session(self, raw):
        if not raw or len(raw) > 256:
            return None
        async with self.engine.connect() as connection:
            row = (await connection.execute(select(browser_sessions).where(*self._scope(browser_sessions),
                browser_sessions.c.session_hash == token_hash(raw), browser_sessions.c.expires_at > time.time()))).first()
            current = await self.active(connection)
        if row is None or current is None or approval_hash(current) != row.configuration_hash or current.definition.issuer != row.issuer:
            return None
        return row, current

    @staticmethod
    def check_csrf(request, session, record):
        header = request.headers.get("X-CSRF-Token", "")
        if (request.headers.get("Origin") != record.definition.origin or not header or len(header) > 256
                or not hmac.compare_digest(token_hash(header), session.csrf_hash)):
            raise PermissionError("Session verification failed. Reload the page before trying again.")

    async def logout(self, raw):
        if raw:
            async with self.engine.begin() as connection:
                await connection.execute(delete(browser_sessions).where(*self._scope(browser_sessions),
                    browser_sessions.c.session_hash == token_hash(raw)))
