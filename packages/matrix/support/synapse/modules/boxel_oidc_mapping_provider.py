"""Boxel custom OIDC user mapping provider.

Synapse's built-in OIDC linking only matches by `(auth_provider_id, sub)` or
the generated localpart — it never consults the verified email. This provider
overrides `map_user_attributes` so that when a Google sign-in's verified email
already belongs to a Matrix account, Synapse returns that account's localpart
and (combined with `allow_existing_users: true`) the grandfather-existing-users
path links the new OIDC identity to the existing mxid rather than creating a
duplicate.

Behaviour:
  - Refuses sign-in if the IdP reports `email_verified` is not true. We use the
    verified-email signal as the entire basis for linking, so blindly trusting
    an unverified email would be an account-takeover surface.
  - Refuses sign-in if more than one existing Matrix account claims the email
    as a verified 3pid. Synapse's schema makes this improbable but not
    impossible (admin-API or migration bypasses), and silently picking one
    would be an account-takeover surface too.
  - On no match, derives the localpart from the email's local part, sanitized
    to the characters Matrix permits in a user ID. If Synapse retries because
    that localpart collided (`failures > 0`), suffixes the failure count.

References:
  - Synapse OidcMappingProvider interface: synapse/handlers/oidc.py
"""

import re

from synapse.handlers.sso import MappingException
from synapse.module_api import ModuleApi
from synapse.types import JsonDict, UserID

# Characters Matrix forbids in a user-ID localpart. Email local-parts permit
# plenty that Matrix does not (e.g. `'`, `!`, `#`), so anything outside the
# allowed set is squashed before we hand the localpart back to Synapse —
# otherwise the no-match new-user path would fail registration for those users.
_DISALLOWED_LOCALPART_CHARS = re.compile(r"[^a-z0-9._=\-/+]")


def _sanitize_localpart(value: str) -> str:
    sanitized = _DISALLOWED_LOCALPART_CHARS.sub("-", value)
    # Guard against an email whose local part is entirely disallowed
    # characters collapsing to an empty/dash-only localpart.
    return sanitized.strip("-") or "user"


class BoxelOidcMappingProvider:
    def __init__(self, config: dict, module_api: ModuleApi) -> None:
        self._config = config
        self._module_api = module_api

    @staticmethod
    def parse_config(config: JsonDict) -> dict:
        return dict(config or {})

    async def get_remote_user_id(self, userinfo: JsonDict) -> str:
        return userinfo["sub"]

    async def map_user_attributes(
        self,
        userinfo: JsonDict,
        token: JsonDict,
        failures: int,
    ) -> JsonDict:
        email = userinfo.get("email")
        if not email or userinfo.get("email_verified") is not True:
            raise MappingException(
                "Google sign-in requires a verified email address."
            )

        email_lower = email.strip().lower()
        matching_user_ids = await self._find_users_by_email(email_lower)

        if len(matching_user_ids) > 1:
            raise MappingException(
                "Multiple Matrix accounts already use this email address; "
                "please contact support to resolve before signing in with Google."
            )

        if len(matching_user_ids) == 1:
            return {
                "localpart": UserID.from_string(matching_user_ids[0]).localpart,
                "display_name": userinfo.get("name"),
                "emails": [email_lower],
            }

        base_localpart = _sanitize_localpart(email_lower.split("@", 1)[0])
        localpart = (
            base_localpart if failures == 0 else f"{base_localpart}{failures}"
        )

        return {
            "localpart": localpart,
            "display_name": userinfo.get("name"),
            "emails": [email_lower],
        }

    async def get_extra_attributes(
        self,
        userinfo: JsonDict,
        token: JsonDict,
    ) -> JsonDict:
        return {}

    async def _find_users_by_email(self, email_lower: str) -> list[str]:
        def _txn(txn) -> list[str]:
            txn.execute(
                "SELECT DISTINCT user_id FROM user_threepids "
                "WHERE medium = ? AND LOWER(address) = ?",
                ("email", email_lower),
            )
            return [row[0] for row in txn]

        return await self._module_api.run_db_interaction(
            "boxel_oidc_find_users_by_email", _txn
        )
