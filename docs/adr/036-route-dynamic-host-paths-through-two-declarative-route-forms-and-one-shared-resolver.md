---
status: proposed
date: 2026-11-11
retroactive: true
recorded: 2026-11-17
scope:
  - packages/runtime-common/route-pattern.ts
  - packages/runtime-common/host-route*.ts
  - packages/runtime-common/host-routing-validation.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/realm-server/lib/host-route-lookups.ts
  - packages/realm-server/lib/realm-routing.ts
  - packages/base/realm-config.gts
  - packages/base/**/*href-to*
  - packages/host/app/services/host-mode-service.ts
  - packages/host/app/routes/index.gts
---

# 036. Route dynamic host paths through two declarative route forms and one shared resolver

A realm served at a host URL can route a family of paths, such as
`/posts/:slug`, to its cards, and links to them can use that address. A route
declares where each `:name` value lives: in the card's id, or in a field.
From that one declaration, a shared resolver finds the card for a path, and
a walk over the same routes finds the address for a card. This ADR builds on
ADR 015 and ADR 033.

## 1. Decision

### 1.1. Two route forms, neither of which computes

A dynamic route in `hostRoutingRules` MUST be one of two forms. A **card id
template** (`"card": "./Person/:person_id"`) fills its `:name` values into a
card id and loads that card by id. A **field match** names a card `type`, an
optional fixed `where`, and the field each `:name` matches
(`"match": { "slug": ":slug" }`), and searches with one `eq` per field. A
redirect MAY copy `:name` values into its target without a lookup. A route
MUST NOT compute a value. Filling a pattern and matching it MUST be inverses
under one canonical encoding (`route-pattern.ts`). A field match's `where`
MUST pass `isClientEvaluable`, so a loaded card can be checked against it.

### 1.2. Routes are an ordered tree, and order decides

Routes MUST be an ordered list in `realm.json`, and a route MAY hold child
routes. At each level, a literal segment MUST be tried before a `:name`
segment at the same position. Dynamic siblings that match the same path MUST
be tried in list order, and a sibling that finds no card the visitor can read
MUST let the next one try. Once a level resolves, it MUST commit: when its
child routes find nothing, the path resolves to nothing, and no earlier level
is tried again. A card's canonical route MUST be the first route that fits it
in depth-first list order, a route's children before its later siblings. A
route MUST NOT fit a card when the address it fills for that card matches a
literal or fixed route at the same level, since the path serves that route. A
card route (card id template or field match) with `"statusCode": 301` is an
**alias**. An alias MUST NOT be canonical. It MUST answer 301 to the card's
canonical address when the card has one, and serve the card when it doesn't.

### 1.3. Nested routes resolve within their parent's card

A dynamic child route's card MUST belong to its parent route's card through a
link: a `linksTo` on the child or a `linksToMany` on the parent. The link
MUST be named in `parent`, or inferred when exactly one link connects the two
types. With two or more, validation MUST drop a route that doesn't name one.
Membership MUST be checked by reading the link on one of the two loaded
cards, with no search. A matched value only has to be unique within its
parent.

### 1.4. One resolver, run as the visitor

Dynamic routes MUST be resolved by `resolveHostRoute` in
`packages/runtime-common`, on the server and in the host app. Top-level fixed
card routes and fixed redirects MAY keep matching by exact path from the
routing map (`matchHostRoutingRule`, `resolveRoutedPath`). Each caller MUST
inject its own `load` and `search`, so they run with the visitor's
permissions. The resolver MUST read only the path and the cards the lookups
return, never the query string, headers, the clock or a random source. When
more than one card a field match serves has the same value, the path MUST
serve the first in the search's own final order, which ends with the card
URL, and the resolver SHOULD log a warning. A link to any of the other cards
gives the same address and opens the first, and the same holds for sibling
routes at one level that match the same path. Keeping values unique is the
author's job. A lookup that fails or is refused MUST end resolution with an error,
which the server answers with 429 for a rate limit and 503 otherwise, never
as not found. When a route matches a path but resolves to nothing, a card's
own path and a realm file MUST still be served there.

### 1.5. Validation is the only way in

The server MUST read routes only through `validateHostRoutes`
(`Realm.getHostRoutes`), as ADR 015 §1.2 requires. A route that fails
validation MUST be dropped with a warning, with its child routes. A field
match's type MUST be read through the definitions cache
(`lookupDefinitionEntry`), as a search reads it. A browser's page request
for a path the route could answer waits for the read, and any other request
MAY get 503 while the read runs. On a cache miss, the read is a module visit
in the prerender server, which ADR 015 §1.1 allows while a request waits. When the
read fails, the route MUST be dropped for now and the validation marked
incomplete, and a path the route could answer MUST get 503, not not-found.
A card's canonical address is known only from every route, so a browser's
request for an alias also waits for the reads, and while the validation is
incomplete every alias of the realm MUST answer 503, not 301 and not its card.
Validation MUST drop each
dynamic route past `MAX_DYNAMIC_HOST_ROUTES`, with a warning. Validation
SHOULD warn when a literal or fixed route takes a path that a dynamic sibling
matches.

### 1.6. Every renderer gets the server's routes

The server MUST put the validated route tree, with `complete`, into the
page's host config as `hostDynamicRoutes`. For a dynamically routed page it
MUST also add a serve rule for exactly the requested path to
`hostRoutingMap`. A realm MUST also serve its validated route tree from a
read-only endpoint, which HTML visits and interact mode read once per
realm and again after the realm is indexed. The endpoint MUST answer only a
visitor who can read the realm. A reader MUST NOT validate the tree again.
The tree, each `where` included, is as visible as the realm, so a route MUST
NOT hold anything a reader of the realm must not see.

### 1.7. Addresses are worked out from the routes, never on the way out

A link's routed address MUST be worked out when the card renders, at
HTML visit and in the browser, by `hostRouteAddress`. It MUST be synchronous
over cards already loaded, and MUST NOT load a card or search. It MUST stop
at the first route in canonical order that it can't decide yet (a card,
parent or value not loaded) and give no address, instead of trying a later
route. When a link needs a card that isn't loaded, the link helper MUST ask
the store for it and give the card's own URL until it arrives, then the
address. The HTML visit MUST wait for those loads before it stores the HTML.
A link to a nested route MAY give one card or id for each dynamic level
(`{{hrefTo category product}}`). Given only the child, the parent MUST come
from the child's link to it, and when only the parent holds the link, the
link MUST fall back to the card's own URL. Where the server needs a card's canonical address, as for an alias's 301, it
MUST work it out from index data, as the visitor, through the same canonical
route walk. Both MUST give the same address for the same card, in the HTML
visit and in the browser alike. An address MUST be the routed path on the URL
that ADR 033 gives for the realm: in stored HTML, the URL that ADR 033 §1.8
has prerendered HTML rendered against, and on a page served on a host URL,
that host URL. The stored HTML MUST carry the address. Whether the realm has
a host URL MUST NOT change the routed path of an address. The server MUST NOT work
out a routed address when a response leaves it. Translating between the
realm's URL and a host URL at that boundary is ADR 033 §1.5: it changes the
URL an address is on, never its routed path. A change to the realm's routes MUST run the realm's HTML visits
again. A link into another realm MUST keep that card's own URL.

### 1.8. Links are portable across realms

A template MUST say what a link points to, and the realm the card renders in
works out the address: one or more cards or ids, a card type with field
values, or a route name given as a named argument
(`{{hrefTo route="people"}}`). A plain string MUST be read as a card id. A
template MUST NOT need to know another realm's routes. A link given a card or
an id MUST fall back to the card's own URL when no route fits it. A link
given a type and field values, or a route name, MUST give `undefined` when no
route fits it, so it renders with no `href`, and MUST NOT fail the render. A
link MUST NOT search for its card. A link from a type and field values is
filled from the values alone, so the route's `where` isn't checked and the
address MAY answer not-found. Route names SHOULD be used only by a site's own
cards, such as its frame, home page and listings. A shared card type SHOULD
use the card or type form. Each link that doesn't resolve MUST be recorded as
a warning in the `diagnostics` of the prerendered HTML row of the card that
rendered it (`prerendered_html.diagnostics`). How the warnings are shown to the author is not
decided here.

### 1.9. No route cache, and no memory of old addresses

The server SHOULD NOT cache the card a path resolves to until the cost of
resolving has been measured. The platform MUST NOT store the addresses a card
had before. When an address moves, the author adds a redirect route from the
old path.

## 2. Rationale

Exact paths need one rule per card [1] (ADR 015 §3). Neither form computes,
so routing needs no interpreter (ADR 015 §1.4). Both forms invert, so an
address leads back to its card [1] and can be worked out from loaded cards
in the HTML visit and the browser alike [5]. The two forms cover the routes
of the earlier build's five demo sites [10]. A field match lets each route
choose its field, and a card id template serves cards that have no such
field, so no card type needs a routing field of its own [10]. Routes are a
list because order decides fall-through and the canonical route, and the
index's `jsonb` keeps array order but not object key order [10].

Order carries meaning because siblings can share a pattern, such as a
`Category` and a `Page` at `/:slug`, and a card can fit more than one route
[4][5]. A route that a literal route shadows doesn't fit, because its address
would open the literal route's card [13]. A resolved level commits so that the cost stays bounded, at most one
lookup per sibling at each level, and a nested URL means one thing: a wrong
pair is not found, not a different page [10]. A card's own path and a realm
file still win, so adding a wide route doesn't break URLs that worked before
[10]. One resolver on both sides gives a full page load and in-app
navigation the same answer [4][7]. Lookups run as the visitor, so the realm
admits, limits and refuses each one as it would the visitor's own request
[6], and a failed lookup isn't a not-found, so a crawler keeps the page [6].
Route validation reads a type's definition as a search does, so the first
request after a restart serves the page instead of not-found [15].
A link can't tell cards with the same value apart, because it doesn't
search, but the resolver's search returns them all and can warn at no extra
cost [13]. The route tree endpoint gives no more than the realm does to the
same visitor [14].

Addresses are worked out at render because the render has the loaded card,
its fields and its `where` check. On the way out, the server would have to
parse the HTML and look up each link on every response. With the address in
the stored HTML, a page is correct with no work per request [10]. The
reverse lookup stops at a route it can't decide yet, because a later route's
address would not be canonical, and the HTML visit and the browser would
disagree once the card loads [5]. It doesn't search, because it must be
synchronous and give the same answer in the HTML visit and in the browser [10].
A nested link may give a card per level, so a template that has both cards
loads nothing more and picks the parent when there are several. One card
also works, because the alias 301, a card's own path, the sitemap and
`og:url` have only one card, and they must give the same address as a link
[5][12]. The server never holds a loaded card (ADR 015 §1.1), so its canonical address
comes from the index [9]. This ADR decides the path of an address. Which URL
the path is on is ADR 033's decision, because it holds for everything in the
stored HTML that names the realm, not only for routed links, and two ADRs
that each state it can come to disagree [16]. Until host URLs serve a realm
directly, a site is a published realm whose own URL is its public address, so
the realm's URL and its host URL are the same [11]. A routed address on the
realm's URL opens its page, because the realm server resolves a publicly
readable realm's routes at the realm's URL too, as it does for a published
realm, which has no host URL [17]. So the stored path depends only on the
realm's routes, whose change already runs the HTML visits again, and not on
whether a host URL exists [17]. A change to a realm's host URLs that changes
the URL its stored HTML is on runs the HTML visits again too (ADR 033 §1.8),
but it changes only that URL, never a path.

A link with no route renders with no `href` instead of failing, as Rails and
Ember do, because there one team owns the templates and the routes. A shared
card must not break a page in a realm whose routes it doesn't control [10].
A route name can't be told from a card id by the shape of the string, so the
name takes a named argument, as Rails and Ember also name a route apart from
its values [10].

There is no route cache until the cost per request has been measured on a
blog-sized realm [10]. Old addresses aren't stored: a table of them needs
storage and cleanup, and two cards can claim the same old address over time.
A hand-written redirect is explicit [10].

## 3. Considered options

- **Two declarative forms with a shared resolver and route walk (chosen).**
- **Exact paths only; authored regular expressions.** Rejected by ADR 015 §3.
- **A stored table from addresses to cards.** It must be kept in sync with
  every card change [8].
- **Page types: a path template answered by a search, with segment values
  computed for each card at indexing [8].** Computed segments need a stored
  value for each card and a way to compute it. A computed field on the card
  type does the same job for types the realm owns [10].
- **A slug on every card.** It forces a field on every card type, including
  types a realm doesn't own, such as catalog cards [10].
- **A computed form, such as a BXL query.** A filter can't apply a function
  to a stored field, so it wouldn't derive slugs, and links would need a
  second expression for the reverse direction. One new key on a route can
  add it later [10].
- **Rewriting links on the way out [8].** Work on every response; see
  Rationale [10].
- **A uniqueness check on field values at indexing.** It needs a search for
  each card that a field match serves [13].
- **A realm with no host URL keeps card URLs [16].** The realm's URL serves
  its routes when the realm is publicly readable, so this would take the
  `href` from links to pages that work. A realm gaining its first host URL
  or losing its last would also change the path of its stored links, not
  only the URL they are on [17].
- **A link that searches for its card when no route fits.** It makes each
  such link slow and async [10].
- **Card types that declare the route names they need, which each realm maps
  to its routes (as Ember engines' `externalRoutes`).** Deferred until a
  shared card must link to a page that isn't a card, such as a search page
  or a cart [10].

## 4. Sources

1. https://github.com/cardstack/boxel/pull/7388
2. https://github.com/cardstack/boxel/pull/7389
3. https://github.com/cardstack/boxel/pull/7423
4. https://github.com/cardstack/boxel/pull/7426
5. https://github.com/cardstack/boxel/pull/7427
6. https://github.com/cardstack/boxel/pull/7435
7. https://github.com/cardstack/boxel/pull/7474 (open)
8. https://github.com/cardstack/boxel/pull/7118 (draft, not for merge)
9. https://github.com/cardstack/boxel/pull/7506 (open)
10. Matic Jurglic, 2026-11-17: answers to this ADR's open questions.
11. Matic Jurglic, 2026-11-17: agreed that stored links keep the routed path
    on the realm's URL, and that ADR 033's prefix swap supplies the host URL.
12. Matic Jurglic, 2026-11-17: agreed that a nested link may give one card
    or one card per level.
13. Matic Jurglic, 2026-11-17: chose that the reverse walk skips a route a
    literal route shadows, and that duplicate values are accepted, with a
    warning from the resolver.
14. https://github.com/cardstack/boxel/pull/7507#discussion_r4599611687
15. Matic Jurglic, 2026-11-17: route validation reads definitions through
    the cache, as a search does; reading a definition is not a routing
    decision.
16. Matic Jurglic, 2026-11-20: the URL an address is on follows ADR 033
    §1.5, and a realm with no host URL keeps card URLs.
17. https://github.com/cardstack/boxel/pull/7645#discussion_r4664565701 and
    https://github.com/cardstack/boxel/pull/7645#discussion_r4663634509:
    `serve-index.ts` resolves routes at the URL of a publicly readable realm,
    and adding or removing a host URL runs no HTML visit.

## 5. Remediation

Known gaps are listed in [remediation/036.md](remediation/036.md).
