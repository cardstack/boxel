"""Unit tests for BoxelInviteCheck.

The realm server's answer is stubbed on the mocked `module_api`, so there is
no Synapse boot, DB, network or Docker stack involved - just the module's
reading of the answer and its fail-closed handling of everything else. They
import the real `synapse.*` types, so they must run inside the pinned Synapse
image (see scripts/test-synapse-modules.sh).
"""

import inspect
import unittest
from unittest.mock import AsyncMock, Mock

from boxel_invite_check import BoxelInviteCheck, InviteCheckConfig
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

    async def test_registers_user_may_invite_with_synapse(self):
        module, module_api = make_module(answer={"allowed": True})
        module_api.register_spam_checker_callbacks.assert_called_once_with(
            user_may_invite=module.user_may_invite
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
