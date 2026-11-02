---
status: proposed
date: 2026-11-01
scope:
  - packages/realm-server/lib/site-boundary.ts
  - packages/realm-server/lib/site-rewrite.ts
  - packages/realm-server/lib/site-frame.ts
  - packages/realm-server/lib/site-files.ts
  - packages/realm-server/lib/host-routes.ts
  - packages/realm-server/server.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/realm-server/handlers/handle-host-route.ts
  - packages/realm-server/handlers/handle-publish-realm.ts
  - packages/realm-server/handlers/handle-unpublish-realm.ts
  - packages/realm-server/handlers/handle-publish-progress.ts
  - packages/host/app/routes/render/html.ts
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

# Present a site's pages through one boundary and base contracts

A site is a realm served live at one or more host URLs, under the realm's own
permissions and policy. One card can be shown on a site, in the app, in code
mode and on several sites, and a site can show cards from other realms. So a
card never decides where it or its links are served, and a page never tells
visitors which realms it draws on. Cards use base contracts that the
environment interprets. Everything a visitor exchanges with a site passes
through one boundary, which maps host URLs to the realm and hides source
realms behind aliases.

## 1. Decision

### 1.1. One boundary

Everything a site's visitor receives or sends, headers included, MUST pass
through the `siteBoundary` middleware. The middleware MUST map a host URL to
the realm's URL on the way in, and back on the way out. It MUST replace every
source realm's URL in a response with that realm's alias. Other code MUST NOT
translate between a realm URL and a host URL or an alias. A translated URL
MUST NOT be stored. The boundary MUST NOT translate requests from the
prerenderer or the indexer, which read stored canonical URLs (ADR 002), or for
a realm viewed in the app. A request MUST be treated as a visit when it names
an alias, is a document request on the site's mount, or carries
`X-Boxel-Site`. The host app MUST send that header only when the page it
booted from names a site. A response the boundary may translate MUST vary on
`X-Boxel-Site`.

### 1.2. Aliases

Each realm a site draws on MUST be served under the site's mount at
`_r/<alias>/`. Those realms are its page types' source realms and the realms
holding its frame, not-found and error cards. The alias MUST be a keyed HMAC
of the site and the realm. It MUST NOT be stored, and MUST resolve only to a
realm that site draws on. A request under an alias MUST be handled as a
request to that realm, under its permissions and policy. An aliased realm's
`realmInfo` MUST describe the site, not the source realm. An alias hides a
realm's name from a site's pages. It MUST NOT stop anyone the realm admits
from reaching the realm at its own URL.

### 1.3. Links are contracts, addresses are set on the way out

A card MUST link to a card or a site path with `<CardLink>`, which renders a
real anchor. A card MUST NOT build a site address itself. It MAY read the
page's path and query from its card context (`sitePath`). Prerendered HTML
MUST NOT hold site addresses. The realm server MUST rewrite a served page's
card links to the addresses the site serves them at, for the request's host.

### 1.4. Who owns a click

A linked card field MUST declare who owns a click on it with `@interactions`
(`CardInteractions` in `card-api.gts`). The app MUST NOT open a card that
declares `'self'`.

### 1.5. The frame

A site MAY name a frame card that places the page with `<SitePage />`. The
realm server MUST compose the frame's prerendered HTML with the page's. The
host app MUST keep the frame mounted across navigation.

### 1.6. Host URLs

A host URL, a host and an optional path prefix, MUST map to a realm through a
stored mapping keyed by the realm's identity. The mapping MUST be resolved
before any other routing. A realm MAY have many host URLs. Exactly one MUST be
canonical: the first added, until its owner picks another. `siteMounts`
(`packages/realm-server/lib/host-routes.ts`) MUST compute the mount a request
is served at and the canonical mount for canonical links and the sitemap. Only
a `realm-owner` of the realm MAY add, remove or mark a host URL canonical, and
only for a name the caller holds. A change MUST take effect when its request
returns. A removed host URL MUST answer 404 at once and free its name. Deleting
a realm MUST remove its host URLs. Exposing a realm MUST write nothing into the
realm.

### 1.7. Live, under the realm's own access

A host URL MUST serve the realm itself, live, with no copy. Every save MUST
show on the site once it is indexed, within the cache lifetimes ADR event-feed
§1.4 allows. Every request through a host URL MUST be judged by the realm's
own permissions and policy, which a host URL neither widens nor narrows. The
server MUST NOT make a new published copy. A copy published before host URLs
MAY keep serving, read-only, until its owner switches it to a host URL or
removes it. Until host origins have sessions (Boxel Connect), every visitor
MUST be treated as a caller who isn't signed in. A host URL MUST offer no
editing. Owners edit in the app.

## 2. Rationale

The Fairway product page named its store realm across its HTML, its config
and its later requests. The concern is disclosure, not access. Translating at
one boundary is the only way a new kind of response can't leak a realm's
name. A derived alias needs no storage, migration or coordination between
servers. It is keyed by the server's secret, so rotating the secret changes
every alias. A request's shape can't tell a visit from a prerender, which
reads the same URLs, so the app says what it is showing. Without the `Vary`,
a shared cache could hand one site's aliased document to another site.

A copy per published site costs disk, index rows and a Matrix user, and adds
a publish job the owner waits on. It must also strip the policy, so a grant
can't admit writes into a public copy. Serving the realm itself removes all of
that, and makes access on a site the same as in the app. A site that takes
writes or serves members needs exactly that. The cost is that a half-finished
edit is public at once. The error card (ADR site-routing §1.5) and the owner's
routes panel are the guard.

Only the environment knows how a card opens. Setting addresses on the way out
lets one card appear on several sites, and lets a site change its paths
without re-rendering. A frame keeps a site's chrome in one card, whole on
first paint and steady across navigation.

## 3. Considered options

- **One boundary, derived aliases, base contracts, the live realm at host
  URLs (chosen).**
- **Keep publishing a copy, or publish only the site's settings.** A frozen
  copy can't take writes or serve members, and a second settings state means
  the site the owner sees isn't the one visitors get.
- **Unlisted links.** With the realm live at its own URL, its permissions
  decide who gets in, not an unguessable slug.
- **An alias per card.** It needs a stored table (ADR site-routing §1.3).
- **Encrypting the realm URL into the alias.** It would decode to any realm,
  where a derived alias resolves only against the site's own sources.
- **Cards build links from `sitePath`.** The Fairway storefront's prerendered
  links came out as `#/shop/…`, invisible to crawlers and tied to one site.
- **Click handlers without anchors.** Crawlers and copied links see nothing.
- **Chrome in each page type's template, or a layout as realm code.**
  Templates drift, and realm code can't decide what to serve (ADR
  site-routing §1.1).

Paths inside a realm, and realm names written into content, stay visible by
design.

## 4. Sources

1. Two drafts folded in here: "Serve the realms a site draws on under aliases
   through one boundary" (now §1.1–§1.2) and "Link and frame a site's pages
   through base contracts, not card code" (now §1.3–§1.5), both proposed in
   9c6748342f. Their last text is at b00efcf485.

## 5. Remediation

Known gaps are listed in [remediation/site-boundary.md](remediation/site-boundary.md).
