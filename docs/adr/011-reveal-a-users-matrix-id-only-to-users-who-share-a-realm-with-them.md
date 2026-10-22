---
status: proposed
date: 2026-10-22
scope:
  - packages/realm-server/**
  - packages/runtime-common/matrix-client.ts
  - packages/host/app/services/matrix-service.ts
  - packages/host/app/services/message-service.ts
  - packages/host/app/services/realm-server.ts
  - packages/host/app/tools/invite-user-to-room.ts
  - packages/host/app/tools/create-ai-assistant-room.ts
  - packages/ai-bot/**
  - packages/bot-runner/**
  - packages/matrix/support/synapse/**
---

# 011. Reveal a user's Matrix id only to users who share a realm with them

A user's Matrix user id is the name they sign in with. Boxel does not show it
to other users, except to the users who have been granted access to the same
realm. Matrix shows every member of a room to every other member, and Synapse
has no setting that hides them. So the rule is kept by controlling who shares a
room, and by turning off the homeserver features that let users find each
other. A design that delivers one event to many users therefore can't put them
in one room.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

In this ADR, an end user is a person's Matrix account. The realm server's
users, the AI bot and the other bots are service users, not end users. A
Matrix id includes its localpart, so these rules cover the username alone too.

### 1.1. Matrix ids are private by default

Boxel MUST NOT reveal an end user's Matrix id to another end user, except as
§1.2 and §1.4 allow. This covers every channel, including room membership,
room state and timelines, user directory search, presence, realm events and
realm-server API responses.

### 1.2. Users who share a realm may see each other

When two end users each hold a realm permission grant that names them in the
same realm, Boxel MAY reveal each one's Matrix id to the other. This includes
the realm owner. The `'*'` grant names no one, so it does not count.

### 1.3. Reading a world-readable realm reveals no one

Reading a world-readable realm, or subscribing to its events, MUST NOT reveal
the reader's Matrix id to another end user. It MUST NOT reveal another end
user's Matrix id to the reader, except as §1.2 and §1.4 allow.

### 1.4. A realm's URL may name its owner

A realm's URL MAY contain the Matrix username of the user who owns it. This
covers the realm-server path `/<username>/<realm>/` and the published-space
host `<username>.<domain>`.

### 1.5. End users share a room only when they may see each other

Two end users MUST NOT both be joined to, or invited to, the same Matrix room
unless §1.2 lets each see the other's Matrix id. A room MAY hold one end user
and any number of service users.

### 1.6. The homeserver doesn't let users find each other

The homeserver MUST NOT return one end user to another in user directory
search. It MUST either disable the user directory or filter it, for example
with a module that implements `check_username_for_spam`. Presence MUST stay
disabled.

The homeserver MUST answer a profile request only when it is authenticated
and the requester shares a room with the user
(`require_auth_for_profile_requests` and
`limit_profile_requests_to_users_who_share_rooms`). It MUST NOT answer profile
requests over federation (`allow_profile_lookup_over_federation: false`).

The homeserver MUST reject an invite from one end user to another unless §1.2
lets each see the other's Matrix id, for example with a module that implements
`user_may_invite`. It MUST NOT put the inviter's profile into an invite
(`include_profile_data_on_invite: false`).

These rules apply to every homeserver Boxel runs, including the configuration
kept outside this repository.

## 2. Rationale

The team decided that Boxel must not expose one user's Matrix username to
another without a reason the user agreed to. Sharing a realm is that reason:
the owner chose whom to grant access to, and collaborators in a realm already
see each other's activity in it.

Matrix gives no way to hide a room's members from each other. A member can
list the room's members, and every join is an event in the room's timeline,
which each member receives through sync. Synapse has no setting that changes
this, as of v1.164.0rc1. Blocking the member-list endpoints at a proxy leaves the
timeline. So the rule has to be kept by deciding who shares a room (§1.5),
not by hiding members after the fact.

Synapse's user directory also returns the members of any room with a `public`
join rule to every user on the server, whether or not they share the room.
One public room would make its members searchable by everyone, so §1.6 turns
the directory off as a backstop.

Room membership isn't the only way to learn a Matrix id. By default, Synapse
answers a profile request for any user, without authentication and over
federation, so anyone can confirm that a guessed Matrix id exists. It also
lets any user invite any other, and the invite shows the inviter's id and
profile. Any client can call these APIs directly, so the host app's own
behavior can't keep the rule. The homeserver has to.

## 3. Considered options

- **Reveal ids only within a shared realm (chosen).** It allows what Boxel
  does today in private realms, and it gives a test a reviewer can apply.
- **Never reveal one user's id to another.** Collaborators in a realm already
  see each other's activity, and realm owners manage grants by Matrix id.
- **Reveal ids when a user accepts an invite from another user.** Boxel has no
  invite flow between end users yet. When it does, its consent rule belongs in
  a change to this ADR.
- **Let users share rooms, and hide the members.** Synapse can't hide members
  from each other, and the timeline still carries every join.

## 4. Consequences

A design that delivers one event to many end users who don't share a realm,
such as the events of a world-readable realm, can't use a room they all join.
It can send to each user's own room, send to-device messages, or deliver
through a realm-server channel. A shared room for a world-readable realm's
events, as proposed in #6906, breaks §1.3 and §1.5.

## 5. Remediation

- `packages/host/app/tools/invite-user-to-room.ts` (`InviteUserToRoomTool`)
  breaks §1.5. It invites any Matrix id to a room, with no check that the
  invitee shares a realm with the room's other end users.
- `packages/matrix/support/synapse/dev/homeserver.yaml`,
  `packages/matrix/support/synapse/test/homeserver.yaml` and
  `packages/matrix/support/synapse/test-without-registration-token/homeserver.yaml`
  break §1.6. They leave the user directory, unauthenticated profile requests,
  profile lookup over federation, and profile data in invites at their
  defaults, which are all on.
- `packages/runtime-common/db-queries/realm-permission-queries.ts` (its use
  of `fetchMatrixProfile`) and
  `packages/realm-server/middleware/multi-realm-authorization.ts`
  (`hasMatrixProfile`) depend on what §1.6 forbids. They ask the homeserver
  for the profile of a user they share no room with, the first without
  authentication, to learn whether the account exists. Under §1.6 that lookup
  fails, and a failed lookup withholds the user's `users` grant. They need
  another way to check an account before the homeserver applies §1.6.
- `packages/matrix/support/synapse/modules/` breaks §1.6. It has no module
  that rejects invites between end users who don't share a realm.
