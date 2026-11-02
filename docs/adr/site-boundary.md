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
permissions and policy. The same card can be shown on a site, in the app, in
code mode, and on more than one site, and a site can show cards from realms
other than its own. So a card never decides where it or its links are served,
and a page never tells visitors which realms it draws on. Cards use base
contracts the environment interprets, and what a visitor exchanges with a site
passes through one boundary that maps host URLs to the realm and hides source
realms behind aliases.

## 1. Decision

### 1.1. One boundary

Everything a site's visitor receives or sends, headers included, MUST pass
through the `siteBoundary` middleware, which MUST map the host URL to the
realm's own URL on the way in and back on the way out, and replace every
source realm's URL in what it sends with its alias. Other code MUST NOT
translate between a realm's URL and a host URL or an alias, and nothing
translated MUST be stored. The boundary MUST NOT translate requests from the
prerenderer or indexer, since what they read is stored canonical (ADR 002), or
for a realm viewed in the app rather than visited as a site. A request MUST
be treated as a visit when it names an alias, is a document request on the
site's mount, or carries `X-Boxel-Site`, which the host app sends only when
the page it booted from names a site, as a prerender never does. A response
the boundary may translate MUST vary on `X-Boxel-Site`.

### 1.2. Aliases

Each realm a site draws on (its page types' source realms, and the
realms holding its frame, not-found and error cards) MUST be served under the
site's mount at `_r/<alias>/`, where the alias is a keyed HMAC of the site and
the realm, never stored, and resolving only to a realm that site draws on. A
request under an alias MUST be handled as a request to that realm, under its
permissions and policy. An aliased realm's `realmInfo` MUST describe the site,
not the source realm, its owner or its publishing. An alias hides a realm's
name from a site's pages; it MUST NOT stop anyone the realm admits from
reaching the realm at its own URL.

### 1.3. Links are contracts, addresses are set on the way out

A card MUST link to a card or a site path with `<CardLink>`, a real anchor,
and MUST NOT build a site address itself; it MAY read the page's path and
query from its card context (`sitePath`). Prerendered HTML MUST NOT hold site
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

### 1.6. Host URLs

A host URL (a host and an optional path prefix) MUST map to a realm through a
stored mapping keyed by the realm's identity, resolved before any other
routing. A realm MAY have many host URLs, and exactly one of them MUST be
canonical: the first added, until its owner picks another. The mount a
request is served at, and the canonical mount its canonical links and sitemap
name, MUST come from `siteMounts` in `packages/realm-server/lib/host-routes.ts`.
Only a `realm-owner` of the realm MAY add or remove a host URL or mark one
canonical, and only for a name the caller holds (a site name they claimed, or a
custom domain among the deployment's overrides), and each change MUST take effect when its request returns, with no
job to poll. A removed host URL MUST answer 404 at once and free its name, with
no redirect, and deleting a realm MUST remove all its host URLs. Exposing a
realm MUST write nothing into the realm; whether its default index card is
prerendered is decided per request.

### 1.7. Live, under the realm's own access

A host URL MUST serve the realm itself, live, with no copy, so every save
shows on the site once it is indexed, within the brief life of the shared
caches ADR event-feed §1.4 allows. Every request through it MUST be judged by the
realm's own permissions and policy, which a host URL neither widens nor
narrows; ADR site-routing §1.4 alone limits whether a realm routes. The server MUST
NOT make a new published copy. A copy published before host URLs MAY keep
serving read-only until its owner switches it to a host URL or removes it. Until host origins have sessions (Boxel Connect), every visitor MUST
be treated as a caller who isn't signed in. A host URL MUST offer no editing;
owners edit in the app.

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

A copy per published site costs disk, index rows and a Matrix user, makes a
publish job the owner waits on, and must strip the policy so a grant can't
admit writes into a public copy. Serving the realm itself removes all of it,
and makes access on a site the same as in the app, which is what a site that
takes writes or serves members needs. The cost is that a half-finished edit is
public at once; the error card (ADR site-routing §1.5) and the owner's routes panel
are the guard. One function computes mounts so the host URL mapping changes
one place.

Only the environment knows how a card opens. Setting addresses on the way out lets one card appear on several
sites and lets a site change paths without re-rendering. A frame keeps chrome
in one card, whole on first paint and unflashing across navigation.

## 3. Considered options

- **One boundary, derived aliases, base contracts, the live realm at host
  URLs (chosen).**
- **Keep publishing a copy, or publish only the site's settings** (the Site
  Card proof of concept): a frozen copy can't take writes or serve members,
  and a second settings state means the site the owner sees isn't the one
  visitors get. An invalid setting keeps its last valid version instead
  (ADR site-routing §1.1).
- **Unlisted links:** with the realm live at its own URL, its permissions, not
  an unguessable slug, decide who gets in.
- **An alias per card:** needs a stored table (ADR site-routing §1.3).
- **Encrypting the realm URL into the alias:** it would decode to any realm,
  where a derived alias resolves only against the site's own sources.
- **Cards build links from `@context.sitePath`:** the Fairway storefront's
  prerendered links came out as `#/shop/…`, invisible to crawlers, and tied to
  one site.
- **Click handlers without anchors:** crawlers and copied links see nothing.
- **Chrome in each page type's template, or a layout as realm code:**
  templates drift; realm code can't decide what to serve (ADR site-routing §1.1).

Still visible by design: paths inside a realm, and realm names written into
content.

## 4. Sources

- Two drafts that never reached main are folded in here, and the files were
  removed: "Serve the realms a site draws on under aliases through one
  boundary" (now §1.1–§1.2) and "Link and frame a site's pages through base
  contracts, not card code" (now §1.3–§1.5), both proposed in 9c6748342f.
  Their last text is at b00efcf485.

## 5. Remediation

Known gaps are listed in [remediation/site-boundary.md](remediation/site-boundary.md).
