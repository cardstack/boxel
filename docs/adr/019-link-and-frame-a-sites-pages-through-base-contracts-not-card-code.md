---
status: proposed
date: 2026-10-31
scope:
  - packages/base/card-link.gts
  - packages/base/site-page.gts
  - packages/base/field-component.gts
  - packages/base/card-api.gts
  - packages/realm-server/lib/site-rewrite.ts
  - packages/realm-server/lib/site-frame.ts
  - packages/realm-server/handlers/serve-index.ts
  - packages/host/app/components/host-mode/**
  - packages/host/app/services/host-navigation.ts
  - packages/host/app/resources/element-tracker.ts
  - packages/host/app/components/operator-mode/overlays.gts
---

# 019. Link and frame a site's pages through base contracts, not card code

A card shown as a page of a site has to link to other cards and pages, and
most sites want a header and footer around every page. The same card can also
appear in the app, in code mode, and on more than one site. If each card
builds its own links and chrome, it has to know where it is and where every
other card is served, and it gets that wrong in some of those places. This
ADR gives card authors three contracts in the base realm. `<CardLink>` links
to a card or a site path. `@interactions` on a linked card field says who
owns a click on it. A site's frame card places the page with `<SitePage />`.
The environment the card renders in decides what each of them does.

## 1. Decision

### 1.1. CardLink

A card MUST link to another card, or to a path of the site it is shown on,
with `<CardLink>`. It renders a real anchor marked with
`data-boxel-card-link`, so a copied link, a new tab and a crawler get a real
address. A card MUST NOT build a site address itself, for example from
`@context.sitePath`. A plain click MUST open the target the way the
environment opens cards: a page navigation on a published site, the stack in
interact mode, the preview in code mode. A modified click MUST be left to the
browser.

### 1.2. Addresses are set on the way out

A card's prerendered HTML MUST NOT hold a site's addresses, because one card
can be shown on several sites. The realm server MUST rewrite a served page's
links (anchors to a card, and anchors marked with a site path) to the
addresses the site serves them at, for the host the request came in on.

### 1.3. Who owns a click on a linked card

A linked card rendered as a field takes `@interactions`:

- `'open'`, the default: the card opens. On a published site it carries a
  link over it; in the app, the app's own click opens it.
- `'self'`: the card handles its own clicks. The app still outlines it, but
  MUST NOT open it on a click.
- `'chrome'`: only the app opens it. It MUST carry no link on a published
  site.
- `'none'`: nothing. The app MUST NOT track it, and it MUST carry no link.

A card with live controls, such as a player or a form, SHOULD use `'self'`.

### 1.4. The frame

A site MAY name a frame card. Its template MUST place the page with
`<SitePage />`. The realm server MUST compose the frame's prerendered HTML
with the page's, so the first paint already has the page inside its frame.
The host app MUST keep the frame mounted while the visitor moves between
pages. The page's card context MUST say it is framed (`siteFramed`), so a card
that draws its own header when it stands alone can leave that to the frame.

## 2. Rationale

Only the environment knows how a card should open: a published site moves to
the card's address, the app pushes a stack item, code mode previews it. A
card that decides for itself is right in one place and wrong in the others.
When the Fairway storefront built its links from `@context.sitePath`, its
prerendered home page linked every product to `#/shop/…`, because a prerender
has no site path; crawlers saw no real links at all. With `<CardLink>`, the
same template produced real addresses everywhere.

Setting addresses on the way out, rather than baking them into the
prerender, is what lets a card appear on more than one site (Host Mode v2) and
lets a site change its paths without re-rendering every card.

A frame card keeps the chrome in one card instead of in every page type's
template. Composing it on the server keeps the first paint whole, and keeping
it mounted keeps navigation from flashing the header.

## 3. Considered options

- **Base contracts that the environment interprets (chosen).**
- **Cards build their own links from `@context.sitePath`.** Fails in the
  prerender, as above, and ties every card to one site's paths.
- **Click handlers without anchors.** Works for a visitor running the app,
  but a crawler and a copied link see nothing.
- **Chrome repeated in each page type's template.** Every page re-renders the
  header, and the templates drift.
- **A site layout written as realm code that the server runs.** ADR 015 §1.1
  forbids running realm code to decide what to serve.

## 4. Remediation

Known gaps are listed in [remediation/019.md](remediation/019.md).
