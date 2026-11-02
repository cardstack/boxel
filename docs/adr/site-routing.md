---
status: proposed
date: 2026-11-01
supersedes: '015'
scope:
  - packages/base/realm-config.gts
  - packages/base/site-routes-panel.gts
  - packages/runtime-common/host-routing-validation.ts
  - packages/runtime-common/site-paths.ts
  - packages/runtime-common/site-settings.ts
  - packages/runtime-common/host-routes.ts
  - packages/runtime-common/index-writer.ts
  - packages/runtime-common/index-query-engine.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/lib/realm-routing.ts
  - packages/realm-server/lib/host-routes.ts
  - packages/realm-server/lib/site-rewrite.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/realm-server/handlers/serve-from-realm.ts
  - packages/realm-server/handlers/handle-host-route.ts
  - packages/realm-server/handlers/handle-publish-realm.ts
  - packages/host/app/services/host-navigation.ts
  - packages/host/app/services/host-mode-service.ts
  - packages/host/app/routes/index.gts
---

# Route a site's paths with data the server interprets and the index answers

A site maps its paths to cards. Its `realm.json` holds fixed pages, redirects,
and page types whose address is a path pattern such as `/shop/:handle`. Each
segment of the pattern is a field of the card, or a BXL expression over it.
One realm-server process serves every realm, so routing is data the server
interprets, never code a realm's author wrote. No table of addresses is
stored. The indexer keeps each card's segment values on its index entry, a
path becomes an index search on them, and a card's address is the pattern
filled in from them. A site acts in other realms only as its visitor.

## 1. Decision

### 1.1. Routing is data, never realm code

The realm server MUST NOT run code a realm's author wrote to decide what to
serve. It MUST NOT import a realm module, evaluate authored code, or wait on a
prerender while a request waits. Routing rules and site settings MUST come as
JSON from the index entry of `realm.json`. Card code MAY compute that JSON
when the realm is indexed. On each read, the server MUST drop a setting that
fails validation, or keep serving its last valid version. Anything the server
evaluates over authored routing input MUST do no I/O and MUST bound its cost.
The server MUST NOT compile authored text into a regular expression. It SHOULD
cap what it reads from one realm (20 page types, 500 redirects). Every host
URL of a realm MUST share the realm's one set of settings.

### 1.2. Path patterns

A page type's `path` MUST be a pattern of literal segments and named segments
(`:name`). A named segment MUST fill one whole segment, with no modifier,
regular expression or wildcard. Its value MUST be the card's field of that
name, or the value of the BXL expression that the page type's `params` map
gives it, for example `{ "slug": ".title | slugify" }`. An expression MUST be
checked against BXL's `route` profile and MUST run with its limits. It MUST
read only the card and linked cards marked `searchable`. It MUST NOT read the
clock, the caller or the request. A segment value MUST be non-empty text
without `/`. A card with no such value has no address under that page type,
and the site's editor MUST show the problem (§1.5). A redirect's source and
target MAY be patterns.

### 1.3. The index is the route table

The realm server MUST NOT store a table of a site's addresses. When it indexes
a card that a page type covers, it MUST evaluate each derived segment and
store the result in the card's search document, as text, beside the
expression that produced it. The expression MUST be stored as BXL's printer
writes it, so that two sites with the same expression share one value. The
server MUST keep a registry of the expressions each realm's cards need. The
registry MUST hold expressions only, never addresses. A new expression MUST
re-index the cards it covers.

The server MUST find a path's card with an index search. The search MUST use
the page type's source realm, card type, filter and sort, with one `eq` per
named segment, on the field or on the stored value. It MUST run as the visitor,
with their credentials, or none, and their client address. The server MUST
derive a card's address from the same values. It MAY read them from the index
or evaluate the same expressions over the card. The server SHOULD remember a
card's earlier values and answer them as its other addresses (§1.5).

### 1.4. One resolver

`resolveSitePath` (`packages/runtime-common/site-paths.ts`) MUST answer every
path a site serves, on the server and in the host app. It MUST try, in order:

1. files and endpoints;
2. literal redirects;
3. fixed pages, listings, and page types with no variables;
4. page types with variables, in declared order;
5. a found card's other addresses, with a 301;
6. redirects with variables;
7. the card's own realm path, with a 301;
8. the not-found card, with a 404.

The routing rules in `realm.json` MUST be read into the site settings as fixed
pages and literal redirects, never resolved apart. A served page MUST carry a route snapshot of its own links, the fixed pages
and the literal redirects. It MUST NOT carry the site's whole route table. The
host app MUST ask the server (`_host-route`) for any other path. A search
that fails or is refused MUST answer 503, or 429 when the anonymous rate limit
refused it, with `Retry-After`. It MUST NOT answer the not-found card. The
server MUST consult a realm's routing, and serve its `sitemap.xml`,
`robots.txt` and `llms.txt`, only when the realm's permissions let everyone
read it, so a private realm never reveals which paths it routes.

### 1.5. One address per page

A served card MUST have one address. Every other address or spelling of it
MUST redirect to it with a 301. A page's canonical link MUST name that address
on the site's canonical host URL (ADR site-boundary §1.6). A not-found or error
page MUST carry no canonical link. Where two cards share an address, the
server MUST serve the first in the page type's sort. A page whose card failed
to render MUST be served as the site's error card, with status 500. The site's
editor SHOULD show the owner each settings problem and each shared address
while the owner types.

### 1.6. Other realms, as a visitor

A rule's target MUST be in the routing realm, unless `realm.json` sets
`serveSourcePrerender`. Then the server MUST first ask the other realm for the
card as the visitor, with no credentials and the visitor's client address. It
MUST serve that realm's prerendered HTML only when the realm answers. A
refusal MUST serve the path as if the rule did not match. A 429 or 503 MUST
answer as in §1.4. A page's validator MUST cover every realm the site draws
on. A page resolved for a signed-in visitor MUST NOT be served from a shared
cache.

### 1.7. A site's operations, as a visitor

A visitor's operation MUST reach the live realm it acts on. That realm MUST
judge it by its own permissions and policy, as the visitor. A site served at a
host URL is the live realm, so its own `_operations` does this. While a site
is served from a published copy, its `realm.json` MAY name the live realm as
`siteOperationsRealm`. The server MUST then forward the site's `_operations`
requests to that realm, with the visitor's credentials removed.

## 2. Rationale

Code an author writes in the realm-server process can read every realm's
files and the server's secrets, and can stall every realm it serves [1]. A
prerender per request is slow, and lets one author tie up the shared pool.

The Fairway golf store showed the cost of exact rules. Its storefront needed
14 generated routing rules and a page card per path, regenerated and
republished whenever a product was added. A stored address table is a second
copy of the index, kept in step on every change. Storing each card's segment
values on its own index entry runs a pattern both ways without that table, and
never runs BXL backwards, which a slug made from a title can't be. A path
becomes an `eq` on the stored value, which the GIN index on the search
document answers in about a millisecond on 3.3 million rows. Values are text
because containment is type-sensitive. Keeping the expression beside its
value keeps the entry readable and lets sites share it with no key to
coordinate.

Two resolvers drift, as an exact rule and a page type once did between the
server and the app. A live pub quiz showed why a refused search is not a
missing card [2]. A room of phones behind one address spent the anonymous
rate limit, and every phone showed the not-found page for a game that was
running. Searching as the visitor lets the policy, the rate limit and the
blocklist answer for them.

A published realm has no token for a private realm, and a published copy
holds no live data and names no policy. Acting in the other realm without
credentials lets that realm's permissions and policy decide (ADR 006).

## 3. Considered options

- **Rules as data, `:name` patterns, values stored at indexing, the index as
  the table (chosen).**
- **Routing functions in card code.** Unsafe in the server, slow in the
  prerender.
- **Authored regular expressions or path-to-regexp modifiers.** One slow
  pattern stalls every realm.
- **A BXL query from the segments to the cards** (the Dynamic Routes draft).
  A card's address can't be derived from the card, so links need a stored
  table again.
- **A forward and a backward expression, both authored.** Nothing can check
  that they agree.
- **A computed field on the card for each segment.** It puts one site's
  addresses into the card type.
- **A hash of the expression as the stored key.** Unreadable in the index,
  and a second spelling of the same expression still gets its own key.
- **RFC 6570 templates (`/shop/{handle}`).** `:name` is the convention
  Rails, Ember and `URLPattern` share.
- **The whole route table in every page.** It grows with the site, and tells
  every visitor every address.
- **Searching as the server.** It routes to cards the policy denies.

## 4. Sources

1. ADR 015, which this ADR supersedes, and the source of §1.1.
2. 2a705ce29a, what a live pub quiz taught site routing.
3. Two drafts folded in here: "Let a realm route to another realm's card"
   (42c150072a, now §1.6) and "Address a site's cards with path templates"
   (9c6748342f, now §1.2–§1.5). Their last text is at b00efcf485.
4. Chris Tse, 2026-11-02: addresses run both ways with BXL, values stored
   beside their normalized expression, written as `:name` segments.

## 5. Remediation

Known gaps are listed in [remediation/site-routing.md](remediation/site-routing.md).
