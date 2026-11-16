---
status: proposed
date: 2026-11-12
retroactive: true
recorded: 2026-11-16
scope:
  - packages/runtime-common/route-pattern.ts
  - packages/runtime-common/host-routes.ts
  - packages/runtime-common/host-route-resolver.ts
  - packages/runtime-common/host-route-address.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/realm-server/lib/host-route-lookups.ts
  - packages/realm-server/lib/realm-routing.ts
  - packages/base/realm-config.gts
  - packages/host/app/services/host-mode-service.ts
---

# 036. Route dynamic host paths through two declarative route forms and one shared resolver

A realm served at a host URL can route a family of paths, such as
`/posts/:slug`, to its cards, and links to those cards can use the readable
address instead of the card id. A route declares where each `:name` value
lives: a position in the card's id, or a field on the card. From that one
declaration, a shared resolver finds the card for a path, and a shared reverse
lookup finds the address for a card. This ADR builds on ADR 015, which
requires routing to be rules the server interprets, and on ADR 033 for the
host URL an address is served at. It records the route forms, how order
decides between routes, where the resolver and the reverse lookup run, how
routes are validated, and how links get their addresses.

## 1. Decision

### 1.1. Two route forms, neither of which computes

A dynamic route in `hostRoutingRules` MUST be one of two forms. A **card id
template** (`"card": "./Person/:person_id"`) fills its `:name` values into a
card id and loads that card by id. A **field match** names a card `type`, an
optional fixed `where`, and the field each `:name` matches
(`"match": { "slug": ":slug" }`), and searches with one `eq` per field. Fixed
card routes and redirects keep their forms, and a redirect MAY copy `:name`
values into its target without a lookup. A route MUST NOT compute a value,
and the patterns follow ADR 015 §1.3. Each form MUST give both directions
from the one declaration: filling a pattern and matching it MUST be inverses
under one canonical encoding (`packages/runtime-common/route-pattern.ts`). A
field match's `where` MUST be one the browser can evaluate
(`isClientEvaluable`), so the reverse lookup can check a card against it.

### 1.2. Routes are an ordered tree, and order decides

Routes MUST be an ordered list in `realm.json`, where each route MAY hold
child routes that resolve within its card. At each level, a route with a
literal segment MUST be tried before a `:name` segment at the same position.
Dynamic siblings that match the same path MUST be tried in list order, and a
sibling that finds no card the visitor can read MUST let the next one try.
Once a level resolves, the match MUST commit: when its child routes find
nothing, the path resolves to nothing, and no earlier level is tried again.
A card's canonical route MUST be the first route that fits it in depth-first
list order, a route's children before its later siblings. A route with
`"statusCode": 301` MUST NOT be canonical. It MUST answer 301 to the card's
canonical address when the card has one, and serve the card when it doesn't.

### 1.3. One resolver and one reverse lookup, each run as its caller

There MUST be one resolver from a path to a card (`resolveHostRoute`) and one
reverse lookup from a card to its address (`hostRouteAddress`), both in
`packages/runtime-common`. The realm server and the host app MUST use them
rather than their own matching. Each caller MUST inject its own lookups, so
they run with the visitor's permissions: the realm server through the realm's
own handler with the visitor's request headers
(`packages/realm-server/lib/host-route-lookups.ts`), the host app through its
authenticated fetch. The resolver MUST read only the path and the cards the
lookups return, never the query string, headers, the clock or a random
source. A lookup that fails or is refused MUST end resolution with an error,
which the server answers with 429 for a rate limit and 503 otherwise, and
MUST NOT be answered as not found. The reverse lookup MUST be synchronous
over cards already loaded: it MUST NOT load a card or search.

### 1.4. Validation is the only way in

The server MUST read routes only through `validateHostRoutes`
(`Realm.getHostRoutes`), as ADR 015 §1.2 requires. A route that fails
validation MUST be dropped with a warning, together with its child routes,
and the remaining routes MUST keep working. A field match's type MUST be read
only from definitions the index has already cached, so a request never waits
on a render (ADR 015 §1.1). A type whose definition isn't cached MUST drop
its routes for now and start a background read, and the validation MUST be
marked incomplete, so a path such a route would answer gets 503, not 404.
A realm SHOULD have at most `MAX_DYNAMIC_HOST_ROUTES` dynamic routes.

### 1.5. Links get their addresses when a card renders

A link to a routed card MUST get its address when the card renders, at
prerender and again in the browser, through the reverse lookup of §1.3. Both
MUST give the same address for the same loaded cards. The server MUST NOT
rewrite links in a response on the way out. A link into another realm MUST
keep that card's own URL.

### 1.6. No route cache, and no memory of old addresses

The server SHOULD NOT cache the card a path resolves to until the cost of
resolving has been measured. The platform MUST NOT store the addresses a card
had before. When an address moves, because a file is renamed or a field
value changes, the author adds a redirect route from the old path.

## 2. Rationale

Before dynamic routes, a host routing rule mapped one exact path to one
card, so a blog with 200 posts needed 200 rules, and a new post had no
address until someone added one [1]. ADR 015 already rejected exact paths
only for that reason, and it bounds what can replace them: no realm code, rules
as data, linear matching.

Neither form computes, so routing needs no interpreter under ADR 015 §1.4.
Both forms invert: a card id template fills and matches the same pattern,
and a field match reads back the fields it searched on. That is what lets a
card's address always lead back to the same card [1], and lets the reverse
lookup work from cards already loaded, in the prerender and in the browser
alike [5]. A stored table from addresses to cards would also give both
directions, but then something has to keep it in sync each time a card
changes; deriving the address from the card does not [8].

Order carries meaning because two siblings can share a pattern, as a
`Category` and then a `Page` at `/:slug` do, and because a card can fit more
than one route [4][5].

One resolver used by both the server and the host app means a full page load
and in-app navigation give the same answer for a path [4][7]. Injecting the lookups
lets each caller run them as its own visitor, so a route resolves only to a
card the visitor could read through its own request, and the realm admits,
limits and refuses the lookup as it would that request [6]. A failed lookup
is not a not-found, so a crawler keeps the page [4][6].

Reading route types from cached definitions keeps a routing decision from
waiting on the prerender to run card code, which ADR 015 §1.1 forbids. Until
a type is cached, an incomplete validation answers 503 rather than drop a
page that may exist [3][6].

The reverse lookup stops at the first route it can't decide yet, rather than
skip to a later route, because a later route's address would not be the
canonical one, and the prerender and the browser would then disagree once
the card loads [5].

## 3. Considered options

- **Two declarative forms, a shared resolver and a shared reverse lookup
  (chosen).** Both directions come from one declaration, and no form needs
  an interpreter.
- **Exact paths only.** Safe, but a family of URLs needs a rule for each
  card (ADR 015 §3) [1].
- **Authored regular expressions or path-to-regexp patterns.** Rejected by
  ADR 015 §1.3 and §3, because one slow pattern can stall the server.
- **A computed form, such as a BXL expression that turns segment values into
  a query.** ADR 015 §1.4 allows one under an interpreter. Neither chosen
  form needs it, and a computed form gets no reverse from its declaration,
  which the reverse lookup needs [5]. See Open questions.
- **Page types: a path template answered by an index search over a page
  type, with each page's address its template filled in** [8]. See Open
  questions for why it was set aside.
- **A stored table from addresses to cards.** Something has to keep it in
  sync each time a card changes [8].
- **Rewriting links, the canonical link and `og:url` in each response on the
  way out** [8]. See Open questions.

## 4. Open questions

No public source states these reasons. Ask Matic Jurglic.

- Why were page types [8] set aside in favor of the two route forms?
- Why was a computed form, such as a BXL query, left out? A probable reason:
  a Boxel filter can't apply a function to a stored field, so a computed form
  wouldn't derive slugs either, and links would need a second, reverse
  expression.
- Was giving every card a slug field, and routing on it, considered? If so,
  why was it rejected?
- Why do links get their addresses at render rather than through rewriting
  responses on the way out, as the earlier build did [8]?
- Why does a level that resolved commit, so that `/hats/trail-runner`
  answers 404 [4] rather than fall back to a later sibling such as `/:page`?
- Why are routes a list rather than an object keyed by path? A probable
  reason: Postgres `jsonb` keeps array order but not object key order, and
  order decides fall-through and the canonical route.
- Why is no route cache built at launch? A probable reason: each dynamic hit
  costs one load by id or one indexed `eq` per level, plus one for each
  sibling that missed before it [4], which may be cheap enough.
- Why doesn't the platform remember a card's old addresses?

## 5. Sources

1. https://github.com/cardstack/boxel/pull/7388 — the pattern parser and
   matcher, and why fill and match are inverses
   (`packages/runtime-common/route-pattern.ts`).
2. https://github.com/cardstack/boxel/pull/7389 — the route fields on
   `RoutingRuleField` (`packages/base/realm-config.gts`), read raw from the
   index.
3. https://github.com/cardstack/boxel/pull/7423 — validation
   (`packages/runtime-common/host-routes.ts`, `Realm.getHostRoutes`).
4. https://github.com/cardstack/boxel/pull/7426 — the resolver
   (`packages/runtime-common/host-route-resolver.ts`).
5. https://github.com/cardstack/boxel/pull/7427 — the reverse lookup
   (`packages/runtime-common/host-route-address.ts`).
6. https://github.com/cardstack/boxel/pull/7435 — serving full page loads
   (`packages/realm-server/handlers/serve-index.ts`,
   `packages/realm-server/lib/host-route-lookups.ts`).
7. https://github.com/cardstack/boxel/pull/7474 and
   https://github.com/cardstack/boxel/pull/7506 (open) — in-app navigation
   through the same resolver, and the 301 from an alias route.
8. https://github.com/cardstack/boxel/pull/7118 (draft, not for merge) — the
   earlier host-mode build, with page types, no stored route table, and
   links rewritten on the way out.
9. ADR 015 and ADR 033.

## 6. Remediation

Known gaps are listed in [remediation/036.md](remediation/036.md).
