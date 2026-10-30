"""Boxel invite check: a Synapse module that rejects invites between end users
who don't share a realm.

Boxel reveals a user's Matrix id to another user only when the two share a
realm, and the Matrix room model shows every member of a room to every other
member. So two end users may share a room only when each holds a realm
permission grant that names them in the same realm (ADR 011 §1.2, §1.5), and
the homeserver has to refuse any other invite between them (§1.6): a client
can call the invite API directly, so the host app's own behavior can't keep
the rule.

A room may hold one end user and any number of service users (the realm
server's account, the AI bot and the other bots, a realm's own account), so
an invite from or to a service user is allowed here, without asking anyone:
a user's session room and AI assistant rooms need no grant, and they are
created before any realm server of a test stack is reachable. A service
user is an account on this homeserver named by the convention `isBotAccount`
applies in packages/runtime-common/db-queries/realm-permission-queries.ts;
test_service_account_vectors.json runs against both, so they can't diverge
unnoticed.

Only the realm server knows the grants, so for an invite between two end
users this module asks it:

    GET <realm_server_url>/_invite-check?inviter=<id>&invitee=<id>
    Authorization: Bearer <shared_secret>

and allows the invite only on a `200` whose body is `{"allowed": true}`.
Anything else, including an unreachable realm server, a non-200 response and
a body of another shape, denies the invite: the module fails closed and logs
a warning, since a homeserver that can't check the rule must not admit an
invite the rule would refuse.

Configuration, under `modules:` in homeserver.yaml:

    - module: boxel_invite_check.BoxelInviteCheck
      config:
        realm_server_url: "https://realm-server.example"
        shared_secret: "<the realm server's MATRIX_INVITE_CHECK_SECRET>"

References:
  - Synapse spam checker callbacks: docs/modules/spam_checker_callbacks.md
"""

import logging
from dataclasses import dataclass
from typing import Any, Literal, Optional, Tuple, Union

from synapse.module_api import NOT_SPAM, ModuleApi
from synapse.module_api.errors import Codes, ConfigError

logger = logging.getLogger(__name__)

# The type Synapse accepts from a `user_may_invite` callback: `NOT_SPAM` to
# allow, or an error code to refuse with.
InviteDecision = Union[Literal["NOT_SPAM"], Codes, Tuple[Codes, dict]]

# The platform's service accounts, by localpart: the AI bot, the submission
# bot and the account a deployed realm server signs in as.
_SERVICE_LOCALPARTS = frozenset({"aibot", "submissionbot", "realm_server"})
# A published realm's account is `@realm/<directory>_<id>`.
_SERVICE_LOCALPART_PREFIXES = ("realm/",)
# A bootstrap realm's account is `@<name>_realm`, the shared account that syncs
# content into one is `@<name>_writer`, and a test stack's realm server is
# `@<name>_realm-server`.
_SERVICE_LOCALPART_SUFFIXES = ("_realm", "_writer", "_realm-server")


def _localpart_on(user_id: str, server_name: str) -> Optional[str]:
    """The localpart of `user_id` when it is the full Matrix id of an account
    on `server_name`; None for an account elsewhere and for text that is no
    Matrix id. A localpart never contains `:`, so the first colon ends it, and
    a server name may carry a port."""
    colon = user_id.find(":")
    if not user_id.startswith("@") or colon < 2 or colon == len(user_id) - 1:
        return None
    if user_id[colon + 1 :] != server_name:
        return None
    return user_id[1:colon]


def is_service_user(user_id: str, server_name: str) -> bool:
    """Whether `user_id` is one of Boxel's service accounts on the homeserver
    `server_name`, rather than a person's account."""
    localpart = _localpart_on(user_id, server_name)
    if localpart is None:
        return False
    return (
        localpart in _SERVICE_LOCALPARTS
        or localpart.startswith(_SERVICE_LOCALPART_PREFIXES)
        or localpart.endswith(_SERVICE_LOCALPART_SUFFIXES)
    )


@dataclass(frozen=True)
class InviteCheckConfig:
    realm_server_url: str
    shared_secret: str


class BoxelInviteCheck:
    def __init__(self, config: InviteCheckConfig, api: ModuleApi) -> None:
        self._config = config
        self._api = api
        api.register_spam_checker_callbacks(user_may_invite=self.user_may_invite)

    @staticmethod
    def parse_config(config: Any) -> InviteCheckConfig:
        if not isinstance(config, dict):
            raise ConfigError("boxel_invite_check: config must be a mapping")
        realm_server_url = config.get("realm_server_url")
        shared_secret = config.get("shared_secret")
        if not isinstance(realm_server_url, str) or not realm_server_url:
            raise ConfigError(
                "boxel_invite_check: realm_server_url must be a non-empty string"
            )
        if not isinstance(shared_secret, str) or not shared_secret:
            raise ConfigError(
                "boxel_invite_check: shared_secret must be a non-empty string"
            )
        return InviteCheckConfig(
            realm_server_url=realm_server_url.rstrip("/"),
            shared_secret=shared_secret,
        )

    async def user_may_invite(
        self, inviter: str, invitee: str, room_id: str
    ) -> InviteDecision:
        server_name = self._api.server_name
        if is_service_user(inviter, server_name) or is_service_user(
            invitee, server_name
        ):
            return NOT_SPAM
        try:
            body = await self._api.http_client.get_json(
                f"{self._config.realm_server_url}/_invite-check",
                args={"inviter": inviter, "invitee": invitee},
                headers={"Authorization": [f"Bearer {self._config.shared_secret}"]},
            )
        except Exception as e:  # noqa: BLE001 - every failure denies the invite
            logger.warning(
                "boxel_invite_check: refusing invite from %s to %s in %s: "
                "the realm server could not be asked: %r",
                inviter,
                invitee,
                room_id,
                e,
            )
            return Codes.FORBIDDEN

        allowed = body.get("allowed") if isinstance(body, dict) else None
        if allowed is True:
            return NOT_SPAM
        if allowed is not False:
            logger.warning(
                "boxel_invite_check: refusing invite from %s to %s in %s: "
                "the realm server answered with an unexpected body: %r",
                inviter,
                invitee,
                room_id,
                body,
            )
        return Codes.FORBIDDEN
