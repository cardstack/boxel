---
status: proposed
date: 2026-11-27
scope:
  - packages/runtime-common/render-session.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/prerender/auth.ts
  - packages/realm-server/prerender/page-pool.ts
  - packages/realm-server/prerender/affinity.ts
  - packages/realm-server/middleware/multi-realm-authorization.ts
  - packages/realm-server/utils/jwt.ts
  - packages/realm-server/tests/render-session-test.ts
---

# 051. Render a realm's own cards on a read-only session, in a tab that never changes hands

A realm renders its own cards and modules (indexing, the HTML it serves, a
module's definition, skill validation) in a pooled prerender tab, and that tab
runs whatever code the realm holds. Anyone who may write the realm can put
code there, an OAuth app with `boxel:write` among them (ADR 021). So the
session such a render holds reads and does nothing else, works nowhere but a
realm's reads and the federated reads, and lasts only as long as the job, and
a tab never moves to another affinity, where code an earlier render left in
the page would read what the next one is handed.

## 1. Decision

### 1.1. The render session

A render whose output a realm keeps and serves to others MUST hold only render
sessions (`runtime-common/render-session.ts`), one per realm it may read. A
render session MUST be signed under `renderSessionSecret`, which no verifier
of any other session accepts. A realm MUST refuse a render session for
anything that needs more than read, before any `X-Boxel-Assume-User`
indirection and without the exact permission match, and the refusal MUST NOT
be turned into an admission by a policy. A realm MUST judge a read presented
with it as a read by the user it names, read fresh, except that the realm's own
Matrix account reads the realm its session names. No verifier MAY read its
`permissions` claim, which is only what the host reads to decide what it shows.
A capture it asks for, and a capture URL it signs, MUST be drawn as no one,
since a capture renders on its reader's own sessions. A realm-server route MUST refuse
it, except the federated reads `multiRealmAuthorization` serves. It MUST
expire when the longest job that renders under it would be given up on.

### 1.2. A tab never changes hands

A prerender tab, its page and its BrowserContext MUST serve only the affinity
they were first handed to. The page pool MUST NOT move a tab to another
affinity, nor give a caller another affinity's tab, even when it has no fresh
tab to give: the caller MUST wait for a fresh standby, or fail.

## 2. Rationale

A day-long session for the realm's owner that carries `realm-owner` and
verifies under the bare realm seed lets code in the tab exchange it for an
ordinary owner session at `/_realm-auth`, and a capture drawn as the owner
renders on the owner's ordinary sessions, in a tab running the captured card's
code. For a person signed in to Boxel that gains nothing, since they can mint
such a session anyway; for an OAuth app it breaks ADR 021 §1.5 and §1.6. A render never legitimately writes (the host refuses writes from a
render), and its reads travel as `GET` or `QUERY`, so a read-only session
costs a render nothing.

The session's key alone isn't enough if tabs move between affinities: a pool
that hands an idle tab of one affinity to a caller of another when no standby
is ready lets a timer an app's module left in the page read a person's
sessions, or another realm owner's. ADR 021 §1.5 keeps an OAuth app's own tab
out of that; every tab runs code some writer chose, so the rule holds for all
of them. A fresh standby is
ready in about a second, and a tab keeps serving renders of its own affinity,
so warm renders stay warm.

## 3. Considered options

- **A read-only session under its own key, and tabs that never change
  hands.** Chosen: it closes the exchange and the cross-affinity reads with
  no change to what a render can see, and reuses the shape of the diagnostic
  session, which already renders cards as the indexer does on a read-only
  session. What a render can read is still its owner's read set (see the
  next-but-one option and ADR 021's remediation file).
- **Bound the render's session by the grant that wrote the code**, as a tab
  token is. An index render renders the whole realm, whoever wrote each file,
  and nothing records which grant wrote which module.
- **Narrow the session to the rendered realm and public realms.** Stronger,
  but a card that links to another of its owner's private realms would lose
  the link. Left until a count of such cards shows what it would break.
- **Tabs that hold no credential, with the server making their requests.**
  Strongest, and a large change to how the host fetches and how the auth
  service worker draws images.
- **Hand the sessions to the page in memory instead of `localStorage`.** Once
  a BrowserContext serves one affinity, its storage holds only that
  affinity's sessions, so this adds nothing, and the auth service worker
  could no longer draw images from it.
- **Close the tab after every render.** Adds a tab's boot to every render.

## 4. Remediation

Known gaps are listed in [remediation/051.md](remediation/051.md).
