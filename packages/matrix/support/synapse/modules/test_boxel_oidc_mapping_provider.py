"""Unit tests for BoxelOidcMappingProvider.

These exercise the provider's decision logic directly with a mocked
`module_api`, so there is no Synapse boot, DB, or Docker stack involved — just
the email-match / ambiguity / collision branches that the linking security
relies on. They import the real `synapse.*` types, so they must run inside the
pinned Synapse image (see scripts/test-oidc-mapping-provider.sh).
"""

import unittest
from unittest.mock import AsyncMock, Mock

from boxel_oidc_mapping_provider import BoxelOidcMappingProvider
from synapse.handlers.sso import MappingException


def make_provider(existing_users=(), users_by_email=()):
    """Build a provider whose module_api is mocked.

    existing_users: localparts that already have an account (drives
        check_user_exists).
    users_by_email: full mxids returned for the email lookup (drives
        _find_users_by_email).
    """
    existing = {f"@{lp}:localhost" for lp in existing_users}
    module_api = Mock()
    module_api.get_qualified_user_id = Mock(
        side_effect=lambda localpart: f"@{localpart}:localhost"
    )
    module_api.check_user_exists = AsyncMock(
        side_effect=lambda user_id: user_id if user_id in existing else None
    )
    module_api.run_db_interaction = AsyncMock(return_value=list(users_by_email))
    return BoxelOidcMappingProvider({}, module_api)


def userinfo(**overrides):
    base = {
        "sub": "google-oauth2|1",
        "email": "alice@gmail.com",
        "email_verified": True,
        "name": "Alice",
    }
    base.update(overrides)
    return base


class MapUserAttributesTests(unittest.IsolatedAsyncioTestCase):
    async def test_refuses_missing_email(self):
        provider = make_provider()
        with self.assertRaises(MappingException):
            await provider.map_user_attributes(userinfo(email=None), {}, 0)

    async def test_refuses_unverified_email(self):
        provider = make_provider()
        with self.assertRaises(MappingException):
            await provider.map_user_attributes(
                userinfo(email_verified=False), {}, 0
            )

    async def test_links_to_existing_account_on_verified_email_match(self):
        provider = make_provider(users_by_email=["@existing:localhost"])
        result = await provider.map_user_attributes(userinfo(), {}, 0)
        self.assertEqual(result["localpart"], "existing")

    async def test_refuses_when_email_matches_multiple_accounts(self):
        provider = make_provider(
            users_by_email=["@one:localhost", "@two:localhost"]
        )
        with self.assertRaises(MappingException):
            await provider.map_user_attributes(userinfo(), {}, 0)

    async def test_new_user_uses_sanitized_email_localpart(self):
        provider = make_provider()
        result = await provider.map_user_attributes(
            userinfo(email="O'Brien@gmail.com"), {}, 0
        )
        # `'` is not a legal Matrix localpart character.
        self.assertEqual(result["localpart"], "o-brien")

    async def test_new_user_suffixes_past_a_colliding_localpart(self):
        # The security regression guard: a verified email that matches no
        # existing 3pid must NOT be linked into an unrelated `@alice` account
        # that merely shares the derived localpart.
        provider = make_provider(existing_users=["alice"])
        result = await provider.map_user_attributes(userinfo(), {}, 0)
        self.assertEqual(result["localpart"], "alice1")

    async def test_new_user_suffixes_past_a_run_of_collisions(self):
        provider = make_provider(existing_users=["alice", "alice1", "alice2"])
        result = await provider.map_user_attributes(userinfo(), {}, 0)
        self.assertEqual(result["localpart"], "alice3")


if __name__ == "__main__":
    unittest.main()
