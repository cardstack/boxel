---
status: proposed
date: 2026-10-30
scope:
  - packages/base/realm-config.gts
  - packages/runtime-common/host-routing-validation.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/handlers/serve-index.ts
---

# 016. Let a site card route to another realm's card, served as that realm prerendered it

A published realm prerenders its pages as itself, and a render gets a token
only for the realms its user is listed on. A page whose content comes from a
private realm, such as a storefront that searches a store realm whose policy
opens its catalog to visitors, therefore prerenders without that content: the
render can't read the realm, and a realm's policy is never consulted for a
render. The realm that holds the card can render it in full. This ADR lets a
realm's site card opt in to routing a path to a card another realm holds,
served as the realm holding it prerendered it, and only where a visitor who
isn't signed in may read that card.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. The site pointer

`realm.json` MAY name the card that configures the realm's published site, in
a `site` attribute that holds the card's id as a string: an absolute URL, a
realm-prefixed id, or a path relative to the realm, resolved as ADR 002 §1.2
requires. It MUST NOT be a link, for the reason `policy` is
not one: a link is side-loaded on every read of `realm.json`. The site card
MUST live in the realm that names it. Host mode MUST read only the fields it
knows from the site card's index entry, and MUST NOT load or render the card
to do so.

### 1.2. Opting in to another realm's card

A host routing rule's target MUST be in the routing realm unless the site card
sets `serveSourcePrerender` to `true`. With that set, a rule whose target is in
another realm MUST be kept and marked as cross-realm instead of dropped.

### 1.3. Serving it

For a cross-realm target, the realm server MUST ask the realm holding the card
whether a request with no credentials may read it, by handling such a request
for the card. Only on success MUST it serve the page with that card's
prerendered HTML, as the holding realm rendered it. On any other answer it
MUST serve the path as if the rule did not match, so a card a visitor may not
read never reaches a public path. The check MUST carry the visitor's address,
so a policy that admits visitors by where they call from can answer it. The
page MUST NOT carry a cache validator derived from the routing realm alone,
since the holding realm can change the card, or stop admitting visitors,
without the routing realm changing.

## 2. Rationale

The same-realm guard exists because, without it, a realm's owner could route
a public path to a private realm's card and publish its prerendered HTML. The
opt-in keeps that guard as the default, and the read check replaces it with
the question that matters: whether the visitor could read the card anyway.
Asking the holding realm to handle an unauthenticated request lets its
permissions and its policy decide, exactly as for a visitor, instead of
reimplementing either here. A search already hands a visitor the prerendered
HTML of rows its policy admits, so serving the prerendered page of a card the
policy admits exposes nothing more.

The opt-in lives on the site card rather than on `RealmConfig` so the realm's
config only points at the site, and a site's settings stay in one card.

## 3. Considered options

- **Opt in on the site card, served only if an unauthenticated read
  succeeds (chosen).**
- **Grant the published realm's render read access to the private realm.**
  Published realms share a server identity, so every published realm's card
  code could then render the private realm's drafts into public HTML.
- **Make the private realm publicly readable.** Its drafts and back office
  would be public too.
- **A `RealmConfig` flag.** It works, but puts site configuration back on the
  realm config.
- **Leave the page to fill in after the app loads.** Visitors who run the app
  see the content after a delay; search engines and link previewers, which
  read the prerendered HTML, never do.

## 4. Remediation

No known gaps.
