---
status: proposed
date: 2026-10-22
scope:
  - packages/realm-server/**
  - packages/runtime-common/matrix-client.ts
  - packages/runtime-common/db-queries/realm-permission-queries.ts
  - packages/host/app/services/matrix-service.ts
  - packages/host/app/services/message-service.ts
  - packages/host/app/services/realm-server.ts
  - packages/host/app/services/ai-assistant-panel-service.ts
  - packages/host/app/tools/**
  - packages/host/app/components/matrix/register-user.gts
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
the realm owner. The `'*'` and `users` grants name no one, so they do not
count. A `RealmPolicy` grant (ADR 006 §1.3) does not count either, even one
whose predicate matches a single user: only a permission row whose subject is
the user names them.

### 1.3. Reading an open realm reveals no one

An open realm is one readable through a `'*'` or `users` grant. Reading an
open realm, or subscribing to its events, MUST NOT reveal the reader's Matrix
id to another end user. It MUST NOT reveal another end
user's Matrix id to the reader, except as §1.2 and §1.4 allow.

### 1.4. A realm's URL may name its owner

A realm's URL MAY contain the Matrix username of the user who owns it. This
covers the realm-server path `/<username>/<realm>/` and the published-space
host `<username>.<domain>`, where each dot in the username is written as a
hyphen so the host stays one label under the domain.

Boxel MUST NOT offer a public or queryable list of realm URLs, except as this
section allows. An endpoint MAY list the realms a user holds a grant on that
names them. An endpoint MAY list world-readable realms that are not published
realms, with their URLs and names: an owner who makes a realm world-readable
agrees to have it found. A list MUST NOT include a published realm. Outside
these lists, a user learns a realm's URL only when someone gives it to them.

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

The homeserver MAY tell a person who is registering whether a username is
taken (`/register/available`), and MUST rate-limit those answers.

These rules apply to every homeserver Boxel runs, including the configuration
kept outside this repository.

### 1.7. Users of other homeservers

ADR 004 lets users of one homeserver hold grants on realms another homeserver
serves, but federation isn't built yet. A design that puts end users of
different homeservers in one room, or lets one invite another, MUST first
change this ADR to say how the invite check of §1.6 learns grants held on
another realm server. A homeserver can see only its own realm server's
grants.

## 2. Rationale

The team decided that Boxel must not expose one user's Matrix username to
another without a reason the user agreed to. Sharing a realm is that reason:
the owner chose whom to grant access to, and collaborators in a realm already
see each other's activity in it.

Matrix gives no way to hide a room's members from each other. A member can
list the room's members, and every join is an event in the room's timeline,
which each member receives through sync. Synapse has no setting that changes
this, as of v1.163.0, the version Boxel runs. Blocking the member-list
endpoints at a proxy leaves the timeline. So the rule has to be kept by
deciding who shares a room (§1.5), not by hiding members after the fact.

A realm readable through a `users` grant has the same shape as a
world-readable one: many readers who chose the realm, not each other. On one
homeserver, `users` is close to everyone. Policy grants are left out because
the homeserver's invite check can't evaluate a predicate, and a predicate can
match as many unrelated users as `users` does.

Synapse's user directory also returns the members of any room with a `public`
join rule to every user on the server, whether or not they share the room.
One public room would make its members searchable by everyone, so §1.6 turns
the directory off as a backstop. Filtering it instead is possible: Synapse
passes `check_username_for_spam` the id of the user who is searching, so a
module can apply §1.2 to each result.

Room membership isn't the only way to learn a Matrix id. By default, Synapse
answers a profile request for any user, without authentication and over
federation, so anyone can confirm that a guessed Matrix id exists. It also
lets any user invite any other, and the invite shows the inviter's id and
profile. Any client can call these APIs directly, so the host app's own
behavior can't keep the rule. The homeserver has to.

Registration is the exception. It has to refuse a username that is taken, so
it always reveals that the username exists. Hiding it from
`/register/available` only moves the answer to the registration request
itself. Synapse rate-limits `/register/available` by client address, which
slows guessing, and a realm URL may name its owner anyway (§1.4).

Federation (ADR 004) is deferred by §1.7 rather than designed here. A
homeserver Boxel doesn't run can't be held to §1.6, and the invite check has
no view of grants on another realm server. Identity checks don't need profile
lookups over federation: ADR 004 §1.3 verifies a user through the OpenID
userinfo endpoint, which §1.6 leaves open.

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
- **Fork or reimplement Synapse to control what it reveals.** A homeserver of
  our own could stop listing a room's members and leave other users' joins out
  of each member's timeline, so end users could share a room without seeing
  each other. That is a large, ongoing undertaking, and it isn't planned now.
  If Boxel takes it on, a change to this ADR can relax §1.5.

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
  defaults, which are all on. `limit_profile_requests_to_users_who_share_rooms`
  has to be turned on together with `require_auth_for_profile_requests`:
  Synapse refuses to start with the first and not the second.
- `packages/runtime-common/db-queries/realm-permission-queries.ts`
  (`fetchEffectiveRealmPermissions`) and
  `packages/realm-server/middleware/multi-realm-authorization.ts`
  (`hasMatrixProfile`) depend on what §1.6 forbids. Both send an
  unauthenticated profile request, through `fetchMatrixProfile`, to learn
  whether the account exists. Under §1.6 that request fails, and a failed
  lookup withholds the user's `users` grant. In
  `multi-realm-authorization.ts` the user is the signed-in principal, whose
  account the realm server verified when it issued their session, so the
  lookup may not be needed there. `fetchEffectiveRealmPermissions` runs in worker
  processes that hold no Matrix client, so it needs another way to check an
  account. Both have to change before the homeserver applies §1.6.
- `packages/matrix/support/synapse/dev/homeserver.yaml`,
  `packages/matrix/support/synapse/test/homeserver.yaml` and
  `packages/matrix/support/synapse/test-without-registration-token/homeserver.yaml`
  also break §1.6 because they load no module (`modules:`) that implements
  `user_may_invite` to reject invites between end users who don't share a
  realm.
- The homeserver configurations for staging and production are kept outside
  this repository, so no entry here can name them. They break §1.6 in the same
  ways as the files above until each one sets the profile and invite settings
  and loads the invite module. `.github/workflows/sync-synapse-assets.yml`
  copies `packages/matrix/support/synapse/modules/` to those homeservers, but
  each configuration still has to list the module under `modules:`.
- `packages/realm-server/lib/key-shares.ts` (`listRealmShares`) breaks §1.1.
  It answers a realm's direct writers with each share's `owner` and
  `suspendedBy` as Matrix ids, whether or not those people still hold a
  permission row naming them in the realm. A share outlives its owner's
  access (an owner who leaves keeps the share, suspended as
  `owner-lost-write`), and the writer who suspended a share may have left
  since. The listing has to withhold either id once no permission row in the
  realm names that person. `packages/host/app/tools/list-realm-key-shares.ts`
  relays them, and the realm config's API Keys entry
  (`packages/base/realm-api-keys.gts`) shows them.
