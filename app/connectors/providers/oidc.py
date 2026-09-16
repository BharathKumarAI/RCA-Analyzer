"""Bounded OIDC code exchange and RS256 verification; secrets stay in this provider."""

import asyncio
import hashlib
import hmac
import json
from urllib.parse import quote_plus

import httpx2
import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

from app.connectors.providers.secrets import environment_secret


class OidcProvider:
    def __init__(self, transport=None):
        self.client = httpx2.AsyncClient(transport=transport, timeout=5, follow_redirects=False, trust_env=False)
        self.exchange_capacity = asyncio.Semaphore(16)

    async def aclose(self):
        await self.client.aclose()

    async def _json(self, method, url, **kwargs):
        async with self.client.stream(method, url, **kwargs) as response:
            response.raise_for_status()
            parts, size = [], 0
            async for part in response.aiter_bytes():
                size += len(part)
                if size > 131072:
                    raise ValueError("Identity provider response exceeds the size limit")
                parts.append(part)
        result = json.loads(b"".join(parts))
        if not isinstance(result, dict):
            raise ValueError("Identity provider response must be an object")
        return result

    async def exchange(self, configuration, code, verifier, nonce_hash):
        data = {"grant_type": "authorization_code", "code": code,
                "redirect_uri": configuration.redirect_uri, "client_id": configuration.client_id,
                "code_verifier": verifier}
        options = {}
        if configuration.token_auth_method != "none":
            secret = environment_secret(configuration.client_secret_reference)
            if configuration.token_auth_method == "client_secret_basic":
                options["auth"] = (quote_plus(configuration.client_id, safe=""), quote_plus(secret, safe=""))
            else:
                data["client_secret"] = secret
        try:
            async with asyncio.timeout(15), self.exchange_capacity:
                response = await self._json("POST", configuration.token_endpoint, data=data, **options)
                encoded = response.get("id_token")
                if not isinstance(encoded, str) or len(encoded) > 16384:
                    raise ValueError("Identity provider did not return a bounded ID token")
                header = jwt.get_unverified_header(encoded)
                if (header.get("alg") != "RS256" or not isinstance(header.get("kid"), str)
                        or not 1 <= len(header["kid"]) <= 256):
                    raise ValueError("Identity token must use a registered RS256 signing key")
                document = await self._json("GET", configuration.jwks_uri)
                keys = document.get("keys")
                if not isinstance(keys, list) or len(keys) > 50:
                    raise ValueError("Invalid signing key set")
                matching = [key for key in keys if isinstance(key, dict)
                            and key.get("kid") == header["kid"] and key.get("kty") == "RSA"
                            and key.get("use", "sig") == "sig" and key.get("alg", "RS256") == "RS256"]
                if len(matching) != 1:
                    raise ValueError("Identity signing key is unavailable or ambiguous")
                key = jwt.PyJWK.from_dict(matching[0], algorithm="RS256").key
                operations = matching[0].get("key_ops", ["verify"])
                if (not isinstance(key, RSAPublicKey) or key.key_size < 2048
                        or not isinstance(operations, list) or "verify" not in operations):
                    raise ValueError("Identity signing key is not approved for secure signature verification")
                claims = jwt.decode(encoded, key, algorithms=["RS256"], issuer=configuration.issuer,
                    audience=configuration.client_id,
                    options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]})
                audiences = claims["aud"] if isinstance(claims["aud"], list) else [claims["aud"]]
                if (len(audiences) > 1 or "azp" in claims) and claims.get("azp") != configuration.client_id:
                    raise ValueError("Identity token authorized party does not match this application")
                nonce = claims["nonce"]
                if not isinstance(nonce, str) or not hmac.compare_digest(hashlib.sha256(nonce.encode()).hexdigest(), nonce_hash):
                    raise ValueError("Identity token nonce does not match this sign-in attempt")
                if not isinstance(claims["sub"], str) or not claims["sub"] or len(claims["sub"]) > 256:
                    raise ValueError("Identity subject is invalid")
                return claims
        except (httpx2.HTTPError, jwt.PyJWTError, ValueError, TypeError, OverflowError, TimeoutError):
            raise ValueError("Identity verification failed. Start a new sign-in attempt.") from None
