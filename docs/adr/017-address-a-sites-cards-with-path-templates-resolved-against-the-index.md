---
status: proposed
date: 2026-10-31
scope:
  - packages/runtime-common/site-paths.ts
  - packages/runtime-common/site-settings.ts
  - packages/runtime-common/host-routes.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/lib/host-routes.ts
  - packages/realm-server/lib/site-rewrite.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/realm-server/handlers/handle-host-route.ts
  - packages/host/app/services/host-navigation.ts
  - packages/host/app/routes/index.gts
  - packages/base/realm-config.gts
  - packages/base/site-routes-panel.gts
---

# 017. Address a site's cards with path templates resolved against the index

A published site serves cards at addresses its owner chooses: a product at
`/shop/linksland-driver`, a journal post at `/journal/2026/reading-fast-greens`.
Each page type in the site settings names its address as a path template over
the card's fields. The server finds the card a path names with one search of
the card index, and works out a card's address by filling in the template.
No table of addresses is stored, so nothing can drift from the cards, and a
catalog of millions of cards costs nothing to keep routed. One function
answers every path, in one precedence order, on the server and in the app.

## 1. Decision

### 1.1. Path templates

A page type's address MUST be an RFC 6570 Level 1 template whose variables
name the card's fields, with a dot to read a linked card's field
(`/c/{category.slug}/{slug}`). A path MUST match a template the way OpenAPI
path templating matches: segment by segment, each variable taking exactly one
whole segment. A key a card derives from its fields MUST be a computed field
on the card. The template MUST NOT transform a value.

### 1.2. No stored table of addresses

The realm server MUST NOT store a table of a site's addresses. It MUST find
the card a path names with a search of the index, one `eq` per variable,
together with the page type's card type and filter. It MUST work out a card's
address by expanding the template with the card's fields.

### 1.3. One precedence order

`resolveSitePath` in `packages/runtime-common/site-paths.ts` MUST answer every
path a site serves, in this order:

1. files and endpoints, which the caller answers first;
2. redirects whose source is literal;
3. fixed pages, then listing paths, then page types with no variables;
4. page types with variables, in declared order, falling through when the
   search finds no card;
5. a found card's other addresses, which redirect to its canonical address;
6. redirects whose source has variables;
7. a card's own path in the realm, which redirects to its address;
8. the site's not-found card, with status 404.

The realm server and the host app MUST NOT resolve a site path any other way.
The host app MAY answer from the route snapshot a served page carries, for the
paths that snapshot lists.

### 1.4. Routing rules are part of the site

The host routing rules in `realm.json` (ADR 015) MUST be read into the site
settings: a rule that serves a card as a fixed page, and a redirect rule as a
literal redirect checked before the site's own. Nothing MUST resolve them
apart from §1.3.

### 1.5. One address per page

A card the site serves MUST have one address. A request for any other address
of the card MUST answer 301, and a request for another spelling of a path
MUST answer 308. A served page's canonical link MUST name its address. A page
answered with the not-found card or the error card MUST NOT carry a canonical
link.

### 1.6. Settings are live, and their problems are shown

The realm server MUST read and validate the site settings on every read, as
ADR 015 §1.2 requires. A page type whose template becomes invalid SHOULD keep
serving at its previous valid template while the server runs. The site's
editor MUST show the owner each problem with the settings, and SHOULD show
the addresses that two cards, or two page types, share. Where two cards share
an address, the first in the page type's sort MUST be served.

## 2. Rationale

The specs began with a stored route table, rebuilt on index events. A table
is a second copy of what the index already holds, and it has to be rebuilt,
backfilled and reconciled whenever a card or a rule changes. For a catalog of
two million items that is two million rows that mean nothing the index
doesn't. A template inverts cheaply instead: a path becomes an `eq` search,
which the index's containment index serves. Measured on 3.3 million index
rows, that search takes 0.4 to 1.1 ms warm.

RFC 6570 and OpenAPI path templating are standards that authors and language
models already know, which matters for settings an owner edits by hand.
Whole-segment matching is linear and needs no regular expression, as ADR 015
§1.3 requires. Keeping transforms out of the template keeps it invertible: a
slug or a year is a computed field, which the index stores and searches.

Two resolvers drift. Before §1.4, an exact routing rule and a page type could
claim the same path and answer it differently on the server and in the app.

## 3. Considered options

- **Path templates over the card's fields, resolved against the index
  (chosen).**
- **A stored table of addresses.** Rejected for the drift and the size
  described in §2.
- **`:name` segments with a query that finds the card.** The address of a card
  can't be worked out from the card, so links need the table again.
- **BXL expressions for addresses** (`"/shop/" & .handle`). Can compute
  anything, which is why they can't be inverted without a table.
- **Keeping realm.json's routing rules apart from the site.** Two places to
  look, and two resolvers.

## 4. Remediation

Known gaps are listed in [remediation/017.md](remediation/017.md).
