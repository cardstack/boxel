---
status: proposed
date: 2026-10-31
scope:
  - packages/realm-server/lib/site-boundary.ts
  - packages/realm-server/server.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/realm-server/handlers/handle-host-route.ts
  - packages/realm-server/lib/host-routes.ts
  - packages/realm-server/lib/site-files.ts
  - packages/host/app/services/network.ts
---

# 018. Serve the realms a site draws on under aliases, through one boundary

A site can show cards from realms other than its own: a shop whose products
live in a store realm. Without care, every page tells its visitors what those
realms are called and who owns them. On the Fairway product page the store
realm's path appeared 27 times, in the inlined card data, the app's config,
the prerendered HTML, and the requests the app made once it booted. This ADR
serves each realm a site draws on under an alias of the site's own, the way a
shared file link hides its owner's folders, and passes everything a visitor
receives through one boundary that applies it. Permissions are unchanged: an
alias is a pseudonym, not a credential.

## 1. Decision

### 1.1. One boundary

Everything a published site's visitor receives MUST pass through the
`siteBoundary` middleware: pages and their config, card and search documents,
modules, and every response header that names a URL. Requests MUST pass
through it too, so an aliased URL in a path, a query or a body reaches the
rest of the server as the realm's own URL. Other code MUST NOT translate a
realm's URL for a visitor itself.

### 1.2. Aliases

Each realm a site draws on (its page types' source realms, and the realms
holding its frame, not-found and error cards) MUST be served under the site's
mount at `_r/<alias>/`. The alias MUST be computed from the site and the
realm with a keyed HMAC, and MUST NOT be stored. An alias MUST resolve only to
a realm that site draws on. The same realm MUST get a different alias on each
site.

### 1.3. Permissions are unchanged

A request under an alias MUST be handled as a request to the realm it names,
whose permissions and policy decide what it may read or do.

### 1.4. Identifiers stay canonical

The index and every stored document MUST hold the realm's own URLs (ADR 002).
The boundary MUST NOT translate a request from the prerenderer or the
indexer. The host app MUST name the site on its requests (`X-Boxel-Site`) only
when the page it booted from names one, which a prerender never does.

### 1.5. An aliased realm describes itself as the site

An aliased realm's `realmInfo` MUST carry the site's name and images. It MUST
NOT carry the realm's Matrix user id or its publishing history.

### 1.6. Only published sites

Only a published site's sources MUST be aliased. A realm its owner is editing,
or previewing in host mode, MUST keep its URLs.

### 1.7. Mounts

The site's mount on the request's host, and the mount its canonical links
name, MUST come from `siteMounts` in `packages/realm-server/lib/host-routes.ts`,
so Host Mode v2's host URL mapping changes one function.

## 2. Rationale

The concern is accidental disclosure, not access. A private store realm named
for its owner and purpose would otherwise be announced on a public shop, even
though nobody gains any access from it. Hiding the names at one boundary,
rather than at each place that builds a response, is the only way to be sure
a new response type doesn't leak them, and it gives the translation a single
test surface. Deriving the alias keeps the design stateless: every server
agrees without coordination, nothing needs migrating or cleaning up, and an
alias is only meaningful for the realms that site declares.

The prerenderer and the indexer must see real URLs, because what they write
is stored, and ADR 002 keeps stored identifiers canonical. A visit is
recognized by what the host app says it is showing, not guessed from a
request's shape, because a prerender reads the same URLs a visitor does.

## 3. Considered options

- **A derived alias per realm, applied at one boundary (chosen).**
- **An alias per card.** Would hide paths inside a realm too, but needs a
  stored table of aliases, which ADR 017 exists to avoid.
- **Encrypting the realm URL into the alias.** Reversible without a lookup,
  but key rotation would break every link a crawler or visitor holds, and the
  site already knows its sources.
- **Translating at each response type.** Every new response type is a new
  chance to leak, with nothing to test it against.
- **Leaving it.** The leak is metadata only, but a realm's name often says
  more than its owner meant to publish.

Still visible, by design: paths inside a realm (`Product/linksland-driver`),
and a realm's name written into content.

## 4. Remediation

Known gaps are listed in [remediation/018.md](remediation/018.md).
