---
status: proposed
date: 2026-11-01
supersedes: ['018', '019']
scope:
  - packages/realm-server/lib/site-boundary.ts
  - packages/realm-server/lib/site-rewrite.ts
  - packages/realm-server/lib/site-frame.ts
  - packages/realm-server/lib/site-files.ts
  - packages/realm-server/lib/host-routes.ts
  - packages/realm-server/server.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/realm-server/handlers/handle-host-route.ts
  - packages/host/app/services/network.ts
  - packages/host/app/services/host-navigation.ts
  - packages/host/app/components/host-mode/**
  - packages/host/app/resources/element-tracker.ts
  - packages/host/app/components/operator-mode/overlays.gts
  - packages/base/card-link.gts
  - packages/base/site-page.gts
  - packages/base/field-component.gts
  - packages/base/card-api.gts
---

# 022. Present a site's pages through one boundary and base contracts

The same card can be shown on a published site, in the app, in code mode, and
on more than one site, and a site can show cards from realms other than its
own. So a card never decides where it or its links are served, and a page
never tells visitors which realms it draws on. Cards use base contracts the
environment interprets, and what a visitor exchanges with a site passes
through one boundary that hides source realms behind aliases.

## 1. Decision

### 1.1. One boundary

Everything a published site's visitor receives or sends, headers included,
MUST pass through the `siteBoundary` middleware, which MUST replace every
source realm's URL in what it sends with its alias, and other code MUST NOT
translate between a realm's URL and its alias. The boundary MUST NOT
translate requests from the prerenderer or indexer, since what they read is
stored canonical (ADR 002), or when the site isn't published. A request MUST
be treated as a visit when it names an alias, is a document request on the
site's mount, or carries `X-Boxel-Site`, which the host app sends only when
the page it booted from names a site, as a prerender never does. A response
the boundary may translate MUST vary on `X-Boxel-Site`.

### 1.2. Aliases

Each realm a published site draws on (its page types' source realms, and the
realms holding its frame, not-found and error cards) MUST be served under the
site's mount at `_r/<alias>/`, where the alias is a keyed HMAC of the site and
the realm, never stored, and resolving only to a realm that site draws on. A
request under an alias MUST be handled as a request to that realm, under its
permissions and policy. An aliased realm's `realmInfo` MUST describe the site,
not the source realm, its owner or its publishing.

### 1.3. Links are contracts, addresses are set on the way out

A card MUST link to a card or a site path with `<CardLink>`, a real anchor,
and MUST NOT build a site address itself. Prerendered HTML MUST NOT hold site
addresses: the realm server MUST rewrite a served page's card links to the
addresses the site serves them at, for the request's host.

### 1.4. Who owns a click

Who owns a click on a linked card field MUST be declared by its
`@interactions` (`CardInteractions` in `card-api.gts`), and the app MUST NOT
open a card that declares `'self'`.

### 1.5. The frame

A site MAY name a frame card that places the page with `<SitePage />`.
The realm server MUST compose the frame's prerendered HTML with the page's,
and the host app MUST keep the frame mounted across navigation.

## 2. Rationale

The Fairway product page named its store realm across its HTML, config and
later requests. The concern is disclosure, not access. Translating at one
boundary is the only way a new response type can't leak. A derived alias
needs no storage, migration or coordination between servers; it is keyed by
the server's secret, so rotating that secret changes every alias. A request's
shape can't tell a visit from a prerender, which reads the same URLs, so the
app says what it is showing. Without the `Vary`, a shared cache could hand
one site's aliased document to another site, or the realm's own document to a
visitor.

Only the environment knows how a card opens. Setting addresses on the way out lets one card appear on several
sites and lets a site change paths without re-rendering. A frame keeps chrome
in one card, whole on first paint and unflashing across navigation.

## 3. Considered options

- **One boundary, derived aliases, base contracts (chosen).**
- **An alias per card:** needs a stored table (ADR 021 §1.3).
- **Encrypting the realm URL into the alias:** it would decode to any realm,
  where a derived alias resolves only against the site's own sources.
- **Cards build links from `@context.sitePath`:** the Fairway storefront's
  prerendered links came out as `#/shop/…`, invisible to crawlers, and tied to
  one site.
- **Click handlers without anchors:** crawlers and copied links see nothing.
- **Chrome in each page type's template, or a layout as realm code:**
  templates drift; realm code can't decide what to serve (ADR 021 §1.1).

Still visible by design: paths inside a realm, and realm names written into
content.

## 4. Remediation

Known gaps are listed in [remediation/022.md](remediation/022.md).
