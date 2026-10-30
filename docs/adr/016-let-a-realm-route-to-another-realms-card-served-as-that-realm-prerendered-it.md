---
status: proposed
date: 2026-10-30
scope:
  - packages/base/realm-config.gts
  - packages/runtime-common/host-routing-validation.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/handlers/serve-index.ts
---

# 016. Let a realm route to another realm's card, served as that realm prerendered it

A published realm prerenders its pages as itself, and a render gets a token
only for the realms its user is listed on. A page whose content comes from a
private realm, such as a storefront that searches a store realm whose policy
opens its catalog to visitors, therefore prerenders without that content: the
render can't read the realm, and a realm's policy is never consulted for a
render. The realm that holds the card can render it in full. This ADR lets a
realm opt in, in `realm.json`, to routing a path to a card another realm
holds. Host mode serves that card as the realm holding it prerendered it, and
only where a visitor who isn't signed in may read it.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. Opting in

A host routing rule's target MUST be in the routing realm unless `realm.json`
sets `serveSourcePrerender` to `true`. With that set, a rule whose target is in
another realm MUST be kept and marked as cross-realm instead of dropped. Host
mode MUST read the setting from `realm.json`'s index entry, with the rules, as
ADR 015 §1.2 requires.

### 1.2. Serving it

For a cross-realm target, the realm server MUST ask the realm holding the card
whether a request with no credentials may read it, by handling such a request
for the card. The request MUST carry the visitor's address as the
client-address middleware set it, so a policy that admits visitors by where
they call from can answer it. Only on success MUST it serve the page with that
card's prerendered HTML, as the holding realm rendered it. On any other answer
it MUST serve the path as if the rule did not match, so a card a visitor may
not read never reaches a public path.

### 1.3. Caching

The page MUST NOT carry a cache validator derived from the routing realm
alone, since the holding realm can change the card, or stop admitting
visitors, without the routing realm changing.

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

The opt-in lives in `realm.json` with the rules it governs, which ADR 015
§1.2 says the server reads from there. A site's editing experience can still
come from a site card: the realm's `realm.json` can adopt a `RealmConfig`
subclass whose fields and editors the site realm supplies, and the server
reads only the base fields.

## 3. Considered options

- **Opt in on `realm.json`, served only if an unauthenticated read succeeds
  (chosen).**
- **Opt in on a separate site card that `realm.json` names.** Keeps a site's
  settings in one card, but the server would read a routing input from a card
  other than `realm.json`, which ADR 015 §1.2 rules out.
- **Grant the published realm's render read access to the private realm.**
  Published realms share a server identity, so every published realm's card
  code could then render the private realm's drafts into public HTML.
- **Make the private realm publicly readable.** Its drafts and back office
  would be public too.
- **Leave the page to fill in after the app loads.** Visitors who run the app
  see the content after a delay; search engines and link previewers, which
  read the prerendered HTML, never do.

## 4. Remediation

Known gaps are listed in [remediation/016.md](remediation/016.md).
