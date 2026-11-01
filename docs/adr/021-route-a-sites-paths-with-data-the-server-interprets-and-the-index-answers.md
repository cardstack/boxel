---
status: proposed
date: 2026-11-01
supersedes: ['015', '016', '017']
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
  - packages/host/app/services/host-navigation.ts
  - packages/host/app/services/host-mode-service.ts
  - packages/host/app/routes/index.gts
---

# 021. Route a site's paths with data the server interprets and the index answers

A published site maps its paths to cards: fixed pages and redirects in
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
validation or keep serving its last valid version. Anything the server evaluates over authored routing input MUST do
no I/O, bound its cost, and compile nothing authored into a backtracking
regular expression.

### 1.2. Path templates

A page type's address MUST be an RFC 6570 Level 1 path template over the
card's fields (a dot reads a linked card's field), each variable one whole
segment, matched segment by segment. A template
MUST NOT transform a value; a derived key is a computed field.

### 1.3. The index is the route table

The realm server MUST NOT store a table of a site's addresses. It MUST find a
path's card by an index search per matching template, run as the visitor (no
credentials, the visitor's client address), and derive a card's address by
expanding its template.

### 1.4. One resolver

`resolveSitePath` (`packages/runtime-common/site-paths.ts`) MUST answer every
path a site serves, for the server and the host app alike, in this order:
files and endpoints; literal redirects; fixed pages, listings and page types
with no variables; page types with variables, in declared order, falling
through when nothing is found; a found card's other addresses (301); redirects
with variables; the card's own realm path (301); the not-found card (404).
`realm.json`'s routing rules MUST be read into the site
settings as fixed pages and literal redirects, not resolved apart. A search
that fails or is refused MUST answer 503, or 429 when the anonymous rate
limit refused it, each with `Retry-After`, and never the not-found card. The
server MUST consult a realm's routing, and serve its `sitemap.xml`,
`robots.txt` and `llms.txt`, only when the realm's permissions let visitors
read it, so a private realm never reveals which paths it routes.

### 1.5. One address per page

A served card MUST have one address; every other address or spelling of it
MUST redirect permanently to it. A page's canonical link MUST name its
address, and a not-found or error page MUST carry none. Where two cards share
an address, the first in the page type's sort MUST be served.

### 1.6. Other realms, as a visitor

A rule's target MUST be in the routing realm unless `realm.json` sets
`serveSourcePrerender`. Then the server MUST first handle a request with no
credentials for the other realm's card, carrying the visitor's client
address, and only on success serve that realm's prerendered HTML. A refusal
MUST serve the path as if the rule didn't match, and a 429 or 503 MUST answer
as in §1.4. A site page's validator MUST cover every realm the site draws on,
never the routing realm alone.

### 1.7. A site's operations, as a visitor

A site's `realm.json` MAY name the live realm its visitors act on
as `siteOperationsRealm`. The server MUST then send a POST to the site's
`_operations` on to that realm's `_operations`, on the same origin and with
the visitor's credentials removed, so the live realm's permissions and policy
judge the visitor as any caller who isn't signed in.

## 2. Rationale

Code an author writes in the realm-server process can read every realm's files
and the server's secrets, and stall every realm it serves. A sandbox like
`node:vm` is not a boundary, and waiting on the prerender per request is slow
and lets one author tie up the shared pool.

A stored address table is a second copy of the index, two million rows for a
two-million-item catalog, rebuilt and reconciled on every change. A template
inverts, and the path's `eq` search takes about a millisecond on 3.3 million
rows. Two resolvers drift, as an exact rule and a page type once did between
server and app. A refused search read as "no card" shows live visitors the
not-found page. Searching as the visitor lets the policy, the rate limit and
the blocklist answer for them; the server's own identity would route to cards
the policy denies.

A published realm prerenders as itself and gets no token for a private store
realm, and the published copy holds no live data and names no policy.
Acting in the other realm without credentials lets that realm's permissions
and policy decide (ADR 006), and a search already hands visitors the
prerendered HTML of rows the policy admits.

## 3. Considered options

- **Rules as data, templates over fields, the index as the table (chosen).**
- **Routing functions in card code**, in the server or the prerender: unsafe
  or slow, as above.
- **Authored regular expressions or path-to-regexp:** one slow pattern stalls
  every realm (ReDoS).
- **`:name` segments with a query, or BXL address expressions:** a card's
  address can't be derived from the card, so links need the table again.
- **Granting the published realm's render read access to the private realm:**
  published realms share a server identity, so every published realm could
  render the private realm's drafts. **Making the private realm public** opens
  its back office too. **Filling content in after boot** hides it from
  crawlers and link previews.

## 4. Remediation

Known gaps are listed in [remediation/021.md](remediation/021.md).
