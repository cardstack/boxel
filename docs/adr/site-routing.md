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

A site maps its paths to cards: fixed pages and redirects in
`realm.json`, and page types whose address is a path template over a card's
fields (`/shop/{handle}`). One realm-server process serves every realm, so
routing is data it interprets, never code a realm's author wrote. No table of
addresses is stored: a path becomes an index search, and a card's address is
its template filled in. Whatever a site shows or does in another realm, it
does as a visitor who isn't signed in.

## 1. Decision

### 1.1. Routing is data, never realm code

The realm server MUST NOT run code a realm's author wrote to decide what to
serve for a request: no `import` of a realm module, no `eval`, `new Function`,
`node:vm` or worker, and no prerender while the request waits. It MUST take
routing rules and site settings as JSON from `realm.json`'s index entry (card
code MAY compute it at indexing), and on each read MUST drop whatever fails
validation or keep serving its last valid version. Anything the server
evaluates over authored routing input MUST do no I/O, bound its cost, and
compile nothing authored into a backtracking regular expression. The server
SHOULD cap what it reads from one realm (20 page types, 500 redirects). Every
host URL of a realm MUST share its one set of settings.

### 1.2. Path templates

A page type's address MUST be an RFC 6570 Level 1 path template over the
card's fields (a dot reads a linked card's field), each variable one whole
segment, matched segment by segment. A template MUST NOT transform a value; a
derived key is a computed field. A redirect's source and target MAY be
templates.

### 1.3. The index is the route table

The realm server MUST NOT store a table of a site's addresses. It MUST find a
path's card by an index search per matching template, built by the server
from the page type's source realm, card type, filter and sort and one `eq` per
variable, and run as the visitor (their credentials, or none, and their client
address). It MUST derive a card's address by
expanding its template.

### 1.4. One resolver

`resolveSitePath` (`packages/runtime-common/site-paths.ts`) MUST answer every
path a site serves, for the server and the host app alike, in this order:
files and endpoints; literal redirects; fixed pages, listings and page types
with no variables; page types with variables, in declared order, falling
through when nothing is found; a found card's other addresses (301); redirects
with variables; the card's own realm path (301); the not-found card (404).
`realm.json`'s routing rules MUST be read into the site settings as fixed
pages and literal redirects, not resolved apart. A served page MUST carry a
route snapshot of only its own links, the fixed pages and the literal
redirects, never the site's whole route table; the host app MUST answer from
it and ask the server (`_host-route`) for any other path. A search
that fails or is refused MUST answer 503, or 429 when the anonymous rate
limit refused it, each with `Retry-After`, and never the not-found card. The
server MUST consult a realm's routing, and serve its `sitemap.xml`,
`robots.txt` and `llms.txt`, only when the realm's permissions let everyone
read it, so a private realm never reveals which paths it routes; a realm its
policy alone opens to visitors serves its cards as a page type's source, not
as a site.

### 1.5. One address per page

A served card MUST have one address; every other address or spelling of it
MUST redirect permanently to it. A page's canonical link MUST name its
address on the site's canonical host URL (ADR site-boundary §1.6), and a not-found or
error page MUST carry none. Where two cards share an address, the first in the
page type's sort MUST be served. A page whose card failed to render MUST be
served as the site's error card, with status 500. The site's editor SHOULD
show the owner each problem with the settings and every address two cards
share, worked out as the owner types.

### 1.6. Other realms, as a visitor

A rule's target MUST be in the routing realm unless `realm.json` sets
`serveSourcePrerender`. Then the server MUST first handle a request with no
credentials for the other realm's card, carrying the visitor's client
address, and only on success serve that realm's prerendered HTML. A refusal
MUST serve the path as if the rule didn't match, and a 429 or 503 MUST answer
as in §1.4. A site page's validator MUST cover every realm the site draws on,
never the routing realm alone. A page resolved for a signed-in visitor MUST
NOT be served from a shared cache.

### 1.7. A site's operations, as a visitor

A visitor's operation MUST reach the live realm it acts on and be judged there
by that realm's permissions and policy, as the visitor. A site served at a
host URL is the live realm, so its own `_operations` does this. While a site
is served from a published copy, its `realm.json` MAY name the live realm as
`siteOperationsRealm`, and the server MUST then send a POST to the site's
`_operations` on to that realm's `_operations` on the same origin, with the
visitor's credentials removed, since a host origin has no sessions yet.

## 2. Rationale

Code an author writes in the realm-server process can read every realm's files
and the server's secrets, and stall every realm it serves. A sandbox like
`node:vm` is not a boundary, and waiting on the prerender per request is slow
and lets one author tie up the shared pool.

The Fairway golf store showed the cost of exact rules alone: its storefront
needed 14 generated routing rules and a page card per path, regenerated and
republished whenever a product was added. A stored address table is a second
copy of the index, two million rows for a
two-million-item catalog, rebuilt and reconciled on every change. A template
inverts, and the path's `eq` search takes about a millisecond on 3.3 million
rows. Two resolvers drift, as an exact rule and a page type once did between
server and app. In a live pub quiz, a room of phones behind one address spent
the anonymous rate limit, and the refused searches read as "no card": every
phone showed the not-found page for a game that was running. A page a crowd
opens at once, like a ticket sale's waiting room, is better served as a fixed
page, which reads one card and searches nothing. Searching as the visitor lets the policy, the rate limit and
the blocklist answer for them; the server's own identity would route to cards
the policy denies.

A published realm prerenders as itself and gets no token for a private store
realm, and a published copy holds no live data and names no policy.
Acting in the other realm without credentials lets that realm's permissions
and policy decide (ADR 006), and a search already hands visitors the
prerendered HTML of rows the policy admits.

## 3. Considered options

- **Rules as data, templates over fields, the index as the table (chosen).**
- **Routing functions in card code**, in the server or the prerender: unsafe
  or slow, as above.
- **Authored regular expressions or path-to-regexp:** one slow pattern stalls
  every realm (ReDoS).
- **`:name` segments with a BXL query, under a `route` BXL profile** (the
  Dynamic Routes draft): a card's address can't be derived from the card, so
  links need a stored table again, which is that draft's open question 1.
  BXL address expressions fail the same way.
- **The route table injected into every page:** it grows with the site and
  tells every visitor every address; a page carries only its own.
- **Searching as the server:** routes to cards the policy denies the visitor.
- **Granting the published realm's render read access to the private realm:**
  published realms share a server identity, so every published realm could
  render the private realm's drafts. **Making the private realm public** opens
  its back office too. **Filling content in after boot** hides it from
  crawlers and link previews.

## 4. Sources

- ADR 015 (`015-express-realm-url-routing-as-rules-the-server-interprets-never-as-realm-code.md`),
  which this ADR supersedes, is the origin of §1.1.
- Two drafts that never reached main are folded in here, and the files were
  removed: "Let a realm route to another realm's card, served as that realm
  prerendered it" (proposed in 42c150072a, now §1.6) and "Address a site's
  cards with path templates resolved against the index" (proposed in
  9c6748342f, now §1.2–§1.5). Their last text is at b00efcf485.
- What a live pub quiz taught site routing: 2a705ce29a.

## 5. Remediation

Known gaps are listed in [remediation/site-routing.md](remediation/site-routing.md).
