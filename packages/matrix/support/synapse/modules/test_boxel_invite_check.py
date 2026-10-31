"""Unit tests for BoxelInviteCheck.

The realm server's answer is stubbed on the mocked `module_api`, so there is
no Synapse boot, DB, network or Docker stack involved - just the module's
reading of the answer and its fail-closed handling of everything else. They
import the real `synapse.*` types, so they must run inside the pinned Synapse
image (see scripts/test-synapse-modules.sh).
"""

import inspect
import json
import os
import unittest
from unittest.mock import AsyncMock, Mock

from boxel_invite_check import (
    BoxelInviteCheck,
    InviteCheckConfig,
    is_service_user,
)
from synapse.module_api import NOT_SPAM
from synapse.module_api.errors import Codes, ConfigError

CONFIG = InviteCheckConfig(
    realm_server_url="https://realm-server.example",
    shared_secret="the shared secret",
)
INVITER = "@inviter:localhost"
INVITEE = "@invitee:localhost"
ROOM = "!room:localhost"


def make_module(answer=None, error=None):
    """Build a module whose realm server answers `answer`, or fails with
    `error`."""
    module_api = Mock()
    module_api.server_name = "localhost"
    if error is not None:
        module_api.http_client.get_json = AsyncMock(side_effect=error)
    else:
        module_api.http_client.get_json = AsyncMock(return_value=answer)
    return BoxelInviteCheck(CONFIG, module_api), module_api


class UserMayInviteTests(unittest.IsolatedAsyncioTestCase):
    async def test_allows_an_invite_the_realm_server_allows(self):
        module, _ = make_module(answer={"allowed": True})
        self.assertIs(await module.user_may_invite(INVITER, INVITEE, ROOM), NOT_SPAM)

    async def test_refuses_an_invite_the_realm_server_refuses(self):
        module, _ = make_module(answer={"allowed": False})
        self.assertEqual(
            await module.user_may_invite(INVITER, INVITEE, ROOM), Codes.FORBIDDEN
        )

    async def test_asks_the_realm_server_for_the_two_users_with_the_secret(self):
        module, module_api = make_module(answer={"allowed": True})
        await module.user_may_invite(INVITER, INVITEE, ROOM)
        module_api.http_client.get_json.assert_awaited_once_with(
            "https://realm-server.example/_invite-check",
            args={"inviter": INVITER, "invitee": INVITEE},
            headers={"Authorization": ["Bearer the shared secret"]},
        )

    async def test_refuses_when_the_realm_server_cannot_be_reached(self):
        # Any failure of the request - a connection error, a non-200 status
        # (the http client raises on those), a timeout - denies the invite.
        module, _ = make_module(error=ConnectionError("refused"))
        with self.assertLogs("boxel_invite_check", level="WARNING"):
            decision = await module.user_may_invite(INVITER, INVITEE, ROOM)
        self.assertEqual(decision, Codes.FORBIDDEN)

    async def test_refuses_an_answer_of_another_shape(self):
        for body in ({}, {"allowed": "yes"}, {"allowed": 1}, [], None, "ok"):
            with self.subTest(body=body):
                module, _ = make_module(answer=body)
                with self.assertLogs("boxel_invite_check", level="WARNING"):
                    decision = await module.user_may_invite(INVITER, INVITEE, ROOM)
                self.assertEqual(decision, Codes.FORBIDDEN)

    async def test_allows_an_invite_from_or_to_a_service_user_without_asking(self):
        # Session rooms and AI assistant rooms are made before any realm
        # server a test stack runs is reachable, and need no grant anyway.
        module, module_api = make_module(error=ConnectionError("unreachable"))
        for inviter, invitee in (
            ("@realm_server:localhost", INVITEE),
            (INVITER, "@aibot:localhost"),
            ("@node-test_realm-server:localhost", INVITEE),
            (INVITER, "@realm/example-user_example-realm:localhost"),
        ):
            with self.subTest(inviter=inviter, invitee=invitee):
                self.assertIs(
                    await module.user_may_invite(inviter, invitee, ROOM), NOT_SPAM
                )
        module_api.http_client.get_json.assert_not_awaited()

    async def test_a_service_account_name_on_another_server_is_an_end_user(self):
        module, module_api = make_module(answer={"allowed": False})
        decision = await module.user_may_invite(
            "@realm_server:elsewhere.example", INVITEE, ROOM
        )
        self.assertEqual(decision, Codes.FORBIDDEN)
        module_api.http_client.get_json.assert_awaited_once()

    async def test_registers_user_may_invite_with_synapse(self):
        module, module_api = make_module(answer={"allowed": True})
        module_api.register_spam_checker_callbacks.assert_called_once_with(
            user_may_invite=module.user_may_invite
        )


# The vectors isBotAccount in the realm server runs too, so the two apply one
# naming convention.
VECTORS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "test_service_account_vectors.json"
)


class ServiceUserTests(unittest.TestCase):
    def test_shared_vectors(self):
        with open(VECTORS_PATH, encoding="utf-8") as f:
            vectors = json.load(f)["vectors"]
        self.assertTrue(vectors)
        for vector in vectors:
            with self.subTest(user_id=vector["userId"]):
                self.assertIs(
                    is_service_user(vector["userId"], vector["serverName"]),
                    vector["serviceAccount"],
                )


class InterfaceShapeTests(unittest.TestCase):
    def test_user_may_invite_is_awaited_by_synapse(self):
        self.assertTrue(inspect.iscoroutinefunction(BoxelInviteCheck.user_may_invite))


class ParseConfigTests(unittest.TestCase):
    def test_reads_the_url_and_secret(self):
        config = BoxelInviteCheck.parse_config(
            {
                "realm_server_url": "https://realm-server.example/",
                "shared_secret": "s",
            }
        )
        self.assertEqual(config.realm_server_url, "https://realm-server.example")
        self.assertEqual(config.shared_secret, "s")

    def test_refuses_a_missing_or_empty_setting(self):
        for config in (
            None,
            {},
            {"realm_server_url": "https://realm-server.example"},
            {"shared_secret": "s"},
            {"realm_server_url": "", "shared_secret": "s"},
            {"realm_server_url": "https://realm-server.example", "shared_secret": ""},
        ):
            with self.subTest(config=config):
                with self.assertRaises(ConfigError):
                    BoxelInviteCheck.parse_config(config)


if __name__ == "__main__":
    unittest.main()
