# Host mode: reconciling the Linear specs with ADRs 021–023

For the specs' author. Nothing here is posted to Linear. It gives every
decision, requirement and open question in the two Linear drafts of
2026-10-29, "Host Mode Dynamic Routes" (DR) and "Host Mode v2" (v2), one
disposition. The ADRs hold the normative text, and this file only points to
them. Delete it once the specs are revised.

- **Adopted:** the ADRs require what the spec asks.
- **Changed:** the ADRs decide differently, for the reason given.
- **Spec only:** a product or UI decision with no architecture in it. Adopted
  as the spec has it; no ADR carries it.
- **Deferred:** the spec defers it too, or it waits on work the spec names.

## Why the design went this way: four sites

**Fairway, a golf store.** The first site was built on published copies and
exact routing rules: 14 generated rules and a page card per path, regenerated
and republished for each new product. Its store realm is private, with a
policy that opens the catalog to visitors. A published realm prerenders as
itself and gets no token for a private realm, so the home page had no
catalog. The storefront built its own links from `@context.sitePath`, so its
prerendered links came out as `#/shop/…` and crawlers saw none. The product
page named the store realm 27 times in its HTML, config and requests.
Visitors got no realm events, so the storefront re-ran its search every 15
seconds, and an edit to a product a visitor had loaded never reached them.
This led to:

- path templates resolved against the index (ADR 021 §1.2–§1.3);
- serving the holding realm's prerender after an unauthenticated read (021
  §1.6);
- `<CardLink>`, with links rewritten on the way out (ADR 022 §1.3);
- one boundary with aliases, which took the store realm's 27 mentions to 0
  (022 §1.1–§1.2);
- the event feed (ADR 023).

**Chorus, a social app.** A few open tabs of a live social feed on one
origin left new tabs hanging. Chrome allows six connections per origin over
HTTP/1.1, and each tab held its own. That is why there is one feed connection
per site in a browser, shared by its tabs (023 §1.5).

**A live pub quiz.** A TV, a quizmaster's signed-in desk and a table of phones,
all signed out but the desk, on one venue network.

- The room shared one address and spent the anonymous rate limit within a
  minute, because every change sent every screen back for the card.
  Revision re-reads are now exempt (023 §1.4).
- Refused page-type searches read as "no card", and every phone showed the
  not-found page for a running game. A failed search now answers 503 or 429
  (021 §1.4).
- A code fix reached the desk but never the TV. Module changes are now
  announced, and refresh requests exist (023 §1.1, §1.8).
- Answers a team may still change are messages on the game card's channel.
  The answer locked in is a card the realm writes from those messages, and an
  emit past the deadline is refused (023 §1.6). No phone's clock decides.

**A ticket sale.** The target the feed is sized for: millions of readers, one
writer stream, and no per-reader state at the origin.

- The crowd reads a small status card on the broadcast lane, as a one-second
  cacheable poll that a CDN collapses (023 §1.3–§1.4).
- Only fans in an exchange, such as a queue place or a seat hold running out,
  hold a personal lane (023 §1.7).
- The waiting room is a fixed page, so it searches nothing (021 §1.4).
- A thousand fans' heartbeats, as ordered emits, queued under one row lock and
  held every pooled connection. Presence is now unordered (023 §1.6).
- Visitors' operations reach the live realm and are judged by its policy (021
  §1.7).

Two smaller demos also fed in. **Field Notes**, a blog with authors and songs
in `ctse/host-mode-v2`, prototyped the projection design: BXL hrefs written to
a stored table on index events. That design is the one ADR 021 rejects (see
the last section). **`developer/handoff-demo`**, a published site in a Boxel
Studio environment, checked the prerender handoff and serving a site through
Boxel Link.

## Host Mode Dynamic Routes

| Item                                    | Disposition                                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 `:name` segments                     | **Changed:** RFC 6570 Level 1 templates (021 §1.2). A template expands in reverse, which answers open question 1.                                                                                                                                         |
| D2 BXL query                            | **Changed:** the server builds the search from the page type (021 §1.3). A BXL query can't be inverted, so links would need a stored table.                                                                                                               |
| D3 `route` BXL profile                  | **Changed:** no longer used for addresses. It survives for page types' share tags (`shareFor`, `runtime-common/host-routes.ts`), which 021 §1.1 governs: no I/O, bounded cost, no authored regex.                                                         |
| D4 the server narrows the query         | **Changed:** the server writes the whole search. It searches the page type's source realm, which may be another realm, as the visitor (021 §1.3).                                                                                                         |
| D5 first result wins                    | **Adopted** (021 §1.5), with an optional sort per page type. The "no sort" warning becomes the routes panel's list of shared addresses (021 §1.5 SHOULD).                                                                                                 |
| D6 order, fall-through                  | **Adopted and extended** to one order for everything (021 §1.4). A failed search answers 503 or 429; it never falls through.                                                                                                                              |
| D7 one resolver, two callers            | **Adopted, changed in part:** `resolveSitePath` answers for server and app alike (021 §1.4), but the app does not search; it answers from its page's route snapshot and asks `_host-route` for anything else, since a browser search saves no round trip. |
| D8 searches run as the visitor          | **Adopted** (021 §1.3).                                                                                                                                                                                                                                   |
| D9 no route cache                       | **Adopted:** no stored table (021 §1.3). Site pages get an ETag over every realm the site draws on (021 §1.6).                                                                                                                                            |
| D10 card code may compute rules         | **Adopted** (021 §1.1). Derived keys are computed fields (021 §1.2).                                                                                                                                                                                      |
| R1–R2 parser, validation                | **Adopted** as template parsing, with validation on every read and the last valid version kept (021 §1.1).                                                                                                                                                |
| R3 result in the rule's realm           | **Changed:** other realms are allowed under 021 §1.6 and through page types' source realms.                                                                                                                                                               |
| R4 cap of 20 dynamic rules              | **Adopted** as SHOULD caps of 20 page types and 500 redirects (021 §1.1).                                                                                                                                                                                 |
| R5 `route` profile                      | **Changed:** kept only for share tags (see D3).                                                                                                                                                                                                           |
| R6 rules injected into the host config  | **Changed:** a page carries a snapshot of only its own links, the fixed pages and the literal redirects (021 §1.4), so no visitor gets the whole table. The trailing-slash 308 stays: another spelling of a path redirects permanently (021 §1.5).        |
| R7 per-host-URL prefixes                | **Adopted** through `siteMounts` (022 §1.6).                                                                                                                                                                                                              |
| R8 async in-app navigation              | **Adopted** (021 §1.4).                                                                                                                                                                                                                                   |
| R9 editor, "test a path"                | **Changed:** a routes panel that shows the settings' problems and every address two cards share, worked out as the owner types (021 §1.5 SHOULD); the build also shows each page type's addresses.                                                        |
| Non-goals                               | **Adopted.** No wildcards or regex (021 §1.2); no post-query BXL; no route cache; one rule set per realm, shared by its host URLs (021 §1.1).                                                                                                             |
| Risk: cost per request                  | Measured at 0.4–1.1 ms warm on 3.3M index rows. The page ETag answers repeat visits.                                                                                                                                                                      |
| Risk: unstable routes, duplicate URLs   | The sort and the routes panel (021 §1.5); one address per page (021 §1.5).                                                                                                                                                                                |
| Risk: routes that depend on the visitor | A page resolved for a signed-in visitor is never shared-cached (021 §1.6).                                                                                                                                                                                |
| Q1 links to routed cards                | **Answered:** templates expand in reverse, and `<CardLink>` links are rewritten on the way out (022 §1.3).                                                                                                                                                |
| Q2 canonical URL                        | **Answered: both.** A card's own path gets a 301 to its address, and the page carries a canonical link (021 §1.4–§1.5).                                                                                                                                   |
| Q3 redirects with segments              | **Answered: yes** (021 §1.2, §1.4).                                                                                                                                                                                                                       |
| Q4 query-string input                   | **Answered:** not part of the address. A card may read the path and query from `sitePath` (022 §1.3).                                                                                                                                                     |
| Q5 fall-through                         | **Answered: yes.** A template searches only when the path has its shape.                                                                                                                                                                                  |
| Q6 ambiguity signal                     | **Answered:** the routes panel shows shared addresses (021 §1.5).                                                                                                                                                                                         |

## Host Mode v2

| Item                                                      | Disposition                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 always live                                            | **Adopted** for content and settings (022 §1.7). The cost is that edits are public at once, guarded by the error card (021 §1.5) and the routes panel. An invalid setting keeps its last valid version (021 §1.1). Today's published copies are listed as gaps. |
| D2 the realm's access governs                             | **Adopted** (022 §1.7, 021 §1.3, §1.7).                                                                                                                                                                                                                         |
| D3 writes when permitted                                  | **Adopted** for visitors who aren't signed in: their operations reach the live realm and its policy (021 §1.7). Signed-in visitors' writes are **deferred** to Boxel Connect (022 §1.7).                                                                        |
| D4 exposing a realm that isn't public                     | **Spec only** for the warning and the one-click grant. The members-only sign-in page is **deferred** to Boxel Connect. Until then, routing and the site files answer only for a realm whose permissions let visitors read it (021 §1.4).                        |
| D5 targets, no unlisted link                              | **Spec only.** Dropping unlisted links is recorded in 022 §3.                                                                                                                                                                                                   |
| D6 many host URLs                                         | **Adopted** (022 §1.6).                                                                                                                                                                                                                                         |
| D7 ids canonical, host URL at the boundary                | **Adopted** (022 §1.1, ADR 002).                                                                                                                                                                                                                                |
| D8 custom domains via overrides                           | **Spec only.**                                                                                                                                                                                                                                                  |
| D9 no extra cache                                         | **Changed in part:** no edge service is required (023 §1.3), but signed-out card reads (023 §1.4), the feed's poll (023 §1.3) and site pages (021 §1.6) are shared-cacheable, so a CDN can be added unchanged (023 §3). Popular sites need one.                 |
| D10 no editing on the host URL                            | **Adopted** (022 §1.7).                                                                                                                                                                                                                                         |
| D11 owners only                                           | **Adopted** (022 §1.6).                                                                                                                                                                                                                                         |
| D12 unexpose answers 404                                  | **Adopted** (022 §1.6).                                                                                                                                                                                                                                         |
| D13 opt-in migration                                      | **Adopted, with an exemption in the ADR:** a copy published before host URLs may keep serving read-only until switched or removed, and no new copy is made (022 §1.7). The switch UI is spec only.                                                              |
| D14 no sessions on host origins                           | **Adopted:** every visitor is anonymous until Boxel Connect (022 §1.7).                                                                                                                                                                                         |
| D15 one canonical host URL                                | **Adopted** (022 §1.6, 021 §1.5). Today's canonical mount is the request's own mount, listed as a gap.                                                                                                                                                          |
| D16 default-index prerendering decided per request        | **Adopted** (022 §1.6). Publishing still writes the flag, listed as a gap.                                                                                                                                                                                      |
| D17–D18 unlisted links frozen, switching deletes the copy | **Adopted** under the same exemption (022 §1.7); the switch's behaviour is spec only.                                                                                                                                                                           |
| D19 CLI publish commands removed                          | **Spec only.** It's a published package: a `feat!:` title.                                                                                                                                                                                                      |
| D20 a host URL adds an address and hides nothing          | **Adopted** (022 §1.2). An alias hides a source realm's name and never blocks access.                                                                                                                                                                           |
| R1 persistent mapping keyed by realm identity             | **Adopted** (022 §1.6). Not built, listed as a gap.                                                                                                                                                                                                             |
| R2 boundary translation                                   | **Adopted** (022 §1.1), with source realms also hidden behind aliases.                                                                                                                                                                                          |
| R3 same access, no policy stripping                       | **Adopted** (022 §1.7). Publishing still strips the policy, listed as a gap.                                                                                                                                                                                    |
| R4 expose/unexpose endpoints                              | **Adopted:** owner-only, only for a name the caller holds (a claimed site name, an override domain), and taking effect when the request returns (022 §1.6).                                                                                                     |
| R5 server rendering, prefixes, canonical                  | **Adopted** (021 §1.4–§1.5, 022 §1.6).                                                                                                                                                                                                                          |
| R6 members-only sign-in page                              | **Deferred** to Boxel Connect.                                                                                                                                                                                                                                  |
| R7 unexpose, realm deletion                               | **Adopted** (022 §1.6).                                                                                                                                                                                                                                         |
| R8–R12 modal, host submode, boot, assistant tools, CLI    | **Spec only.** R10's host-URL links are 022 §1.3.                                                                                                                                                                                                               |
| R13–R15 migration                                         | **Spec only.**                                                                                                                                                                                                                                                  |
| Non-goals                                                 | **Adopted**, except that the CDN is optional rather than a non-goal (see D9).                                                                                                                                                                                   |
| Risk: live edits are public                               | The error card, served with a 500 (021 §1.5). A failed page-type card is still served as a 404, listed as a gap.                                                                                                                                                |
| Risk: load on the editing realm                           | Shared-cacheable reads and the feed (023).                                                                                                                                                                                                                      |
| Risk: wider exposure from the policy                      | Visitors' operations are judged by the realm's policy (021 §1.7).                                                                                                                                                                                               |
| Risk: translation leaks                                   | One boundary (022 §1.1). Card source and compressed bodies are listed as gaps.                                                                                                                                                                                  |
| Q1 launch anonymous-only or wait for Boxel Connect        | **Answered:** launch anonymous-only (022 §1.7). Exposing does not require public read: a realm its policy alone opens serves its cards through other sites' page types, but routes nothing as a site of its own (021 §1.4).                                     |

## Where the specs and earlier rulings disagree

- **Settings on publish:** a ruling of 2026-10-30 had site settings take
  effect only when published. The build plan of 2026-10-31 chose live, as v2
  D1 does, with the routes panel as the guard. The ADRs follow the plan.
- **Path collisions:** a ruling of 2026-10-29 had the older claim win. The
  ADRs serve the first card in the page type's sort, which the owner controls
  (DR D5).
- **Stored address table:** the projection design of 2026-10-29 stored hrefs.
  ADR 021 §1.3 stores none, for the drift and size reasons in its rationale.
