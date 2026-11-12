---
status: proposed
date: 2026-11-10
scope:
  - packages/runtime-common/realm.ts
  - packages/runtime-common/**/*run-token*
  - packages/realm-server/**/*run-token*
  - packages/runtime-common/**/*run-overlay*
  - packages/realm-server/**/*run-overlay*
  - packages/realm-server/lib/key-bindings.ts
  - packages/realm-server/lib/key-uses.ts
  - packages/runtime-common/card-operations/call-api.ts
  - packages/runtime-common/automation-run-limits.ts
  - packages/realm-server/handlers/handle-request-forward.ts
  - packages/realm-server/middleware/index.ts
  - packages/realm-server/middleware/multi-realm-authorization.ts
  - packages/realm-server/prerender/render-runner.ts
  - packages/realm-server/prerender/affinity.ts
---

# 026. Give an automation run a token for its realm alone, and act as a person through `Realm.handleAutomation`

An automation's script runs with nobody watching, in a prerender tab that the
server doesn't trust. So the realm server, not the tab, decides what
each of a run's calls may do. A run gets a token of its own that reaches only
its automation's realm. Every call with that token goes through
`Realm.handleAutomation`, which checks it against the run and the
automation's declaration. Each call also takes the full permission check as
the person the run acts as, never as the realm's own user. This ADR builds on
ADR 006 and ADR 024 §1.3.

## 1. Decision

### 1.1. The run's identity

A run MUST act as one person, the run's identity: the payer for a scheduled
run (cron, one-time or webhook), the person who clicked for Preview and Run
now, and the submitting run's identity for a follow-up run. The payer MUST be
the direct writer who switched the automation on.

### 1.2. One token per run, for its realm alone

Each run MUST get a token minted for that run, for the run's identity, that
names the run. The token MUST admit read and write in the automation's realm,
and read in the base and catalog realms, and nothing else. Every call the
script makes MUST carry that token. The host MUST keep the token outside
QuickJS and add it to the run's requests. It MUST NOT write the token
anywhere the tab keeps state, such as `localStorage` or a cookie.

Other code in the tab can still reach the token, so these rules bound what a
leaked token gives away:

- A tab that runs a run MUST NOT hold any session or token except the tokens
  of runs with the same realm and the same identity. It MUST NOT hold the run
  identity's ordinary realm session, or the prerender auth that
  `prepareRunCommand` mints for every realm its `runAs` user can reach.
- A run's cards MUST load modules only from the automation's realm, the base
  realm and the catalog realm. A run MUST NOT start while a policy grant
  gives write to a module that it loads from its own realm, directly or
  through an import.

Switching on an automation whose cards load a module from any other realm
MUST be refused, and the refusal MUST name that realm.

### 1.3. Every call goes through `Realm.handleAutomation`

The realm server MUST handle each request to a realm that carries a run
token through `Realm.handleAutomation`, and through no other entry point.
`Realm.handleAutomation` MUST refuse a call unless the run's row says the run
is still running, its time limit has not passed, and its caps are not spent.
A cancel or a pause MUST stop the run's next call.

A realm-server route that serves a run's requests to no realm, such as
forwarding its AI requests, MUST make the same checks against the run's row
before it acts: the token verifies under the run-token key, its identity's
sessions were not revoked after it was minted, the run is running and owned
by the token's attempt, and the caps that bound what the route does are not
spent. Every other realm-server route MUST refuse a run token.

Only a run token MUST reach automation mode. The server MUST treat a request
as an automation call because it carries a run token, and for no other
reason. A binding approved only for automations MUST NOT admit a request
without one.

### 1.4. The server enforces the declaration

A `callApi` entry in a run's call MUST be an automation call, admitted
through `automationAdmission` for the run's identity. It MUST be refused when
the automation does not declare its operation. A write MUST target only the
automation's realm. A run MUST NOT write the realm's `realm.json`, the card
its `policy` names, any `RealmPolicy` card, or any automation card. The
server MUST read the declaration from the indexed automation card, as data,
and MUST NOT run card code to learn it.

The server MUST meter a run's counts (`callApi` calls, response bytes,
`resolve` calls, writes) where it does the work, and MUST NOT take a count
from the tab. Each automation call MUST be recorded in `key_uses` with
`mode = 'automation'` and the run's id.

### 1.5. Act as a person, never as the realm

Every call and write of a run MUST take the full permission check as the
run's identity (ADR 006). The run's identity MUST be a direct writer of the
automation's realm when the run is admitted. That MUST be confirmed again
just before the run's writes commit. A run MUST NOT act as the realm's own
user, as a service identity, or through `assume-user`. A policy grant MUST
NOT make a user a payer or a run's identity.

## 2. Rationale

The tab can reach any address, and a `run-command` job holds auth for every
realm its `runAs` user can reach (`prepareRunCommand`). The script's sandbox keeps it away
from both, but a check that ran in the tab would be only as strong as the
tab. So the token is the boundary. It reaches one realm, it names one run, so
the server can tie each call to that run's row and declaration, and the
server counts what costs money next to the work.

The script's sandbox doesn't cover the rest of the tab. A run's cards load
their modules as ordinary page JavaScript, in the same page as the host code
that holds the token, and nothing inside one page stops a module from reading
what the host can read or from wrapping `fetch`. So the token's secrecy
inside the tab is not the boundary. A leak is bounded by what else the tab
holds and by whose code runs there. A tab that held another run's token, or
the identity's wider session, would hand it to any module loaded beside it.
The prerender pool already keeps each affinity's tabs to one session for the
same reason.

Module code runs with the payer's direct write and credit. A policy grant can
give write to module source, and the owner of a public realm needs no
permission in this realm at all. Either could then act with more authority
than they hold. So a run loads modules only from its own realm, which only
direct writers can change while it runs, and from the base and catalog
realms, which the platform deploys from reviewed source. An author who wants
a card from another realm copies it into their own.

Calls from the tab reach the server over the network, like any other
request, so the token is the only thing that can mark one as an
automation's. If anything else could mark it, an ordinary session (the
identity's own browser, or a tab's prerender auth) could use the bindings
approved for automations with no run, caps or declaration behind it.

A person's permissions are the rule every other write in a realm already
follows, so a run's writes need no second permission model. The realm's own
user can write anything in the realm, and a service identity would be a new
principal that no realm permission names. Either would let anyone who can
edit an automation card write with more authority than they hold.
`assume-user` is the realm user's power to act as someone, so it would make
the realm, not the person, the source of the authority.

Direct write is administration (ADR 024 §1.3). A payer spends their own
credit, and a run acts with their authority while nobody watches, so only an
administrator may be one. A policy grant can give write access to many
people. If a grant could make someone a payer, whoever edits the policy could
choose who pays. Permissions change while an automation runs on its
schedule, so direct write is checked again just before the writes land.

A direct writer can change `realm.json` and the policy card (ADR 024 §1.3),
and so can a run that acts as one. A run is unattended and handles
third-party data and webhook payloads, so it must not be able to change who
can reach its realm, or widen the declaration that bounds its next run.
ADR 021 §1.6 sets the same limit for OAuth tokens, which also act as a
person. A card that loads a module from another realm would be refused on
every run, so it is refused once, when it is switched on.

## 3. Considered options

- **A run token for one realm, checked in `Realm.handleAutomation`, acting
  as the run's identity (chosen).**
- **The payer's ordinary realm session.** It reaches every realm the payer
  can, and nothing ties a call to the run, its caps or its declaration.
- **Prerender auth for every realm `runAs` can reach.** It has the same reach,
  and it is held by the tab, which the script runs in.
- **Keep the token secret inside the tab.** Card modules run as page code
  beside the host, so nothing in one page can hide the token from them.
- **Several identities' or realms' runs in one tab.** Module code loaded for
  one run could use another run's token, for another payer or realm.
- **Load modules from any public realm.** Their owners need no permission in
  the automation's realm, yet their code would run with the payer's
  authority.
- **Enforcement in the tab.** The tab runs code that the realm doesn't
  trust, and its counts would be reported by the party they bound.
- **A run with its identity's full direct write.** The run could rewrite the
  realm's policy, or widen its own automation's declaration for the next run.
- **Acting as the realm's own user.** Anyone who can edit the card could
  write with the realm's full authority.
- **A service identity per realm.** It is a new principal outside the
  permission model, with the same problem.
- **`assume-user`.** The authority would come from the realm user, not from
  the person.

## 4. Remediation

Known gaps are listed in [remediation/026.md](remediation/026.md).
