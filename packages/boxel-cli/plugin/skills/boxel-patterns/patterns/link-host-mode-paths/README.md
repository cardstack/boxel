---
validated: source-proven
---

# link-host-mode-paths — Route clean external URLs (`/`, `/about`, `/blog`, `/pricing`) to cards via `realm.json`

**What this gives you:** Configure a realm so visitors hitting `https://your-host.com/about` (or `/blog`, `/pricing`, anything you choose) see a specific CardDef instance — instead of the underlying `<host>/MyCard/abc-123` ID-based URL. Driven entirely from the realm config card at `/realm.json`; no code changes on the consuming cards.

**When to use:** Any time a _published_ realm is the public face of an app — marketing sites, blogs, portfolios, documentation, app-card homes that need a memorable URL bar. The user-facing URL becomes a curated path you control; the underlying cards keep their natural ID-based URLs internally.

**The insight:** Boxel's realm-server reads `hostRoutingRules` off the indexed `RealmConfig` card on every host-mode request. When the requested path matches a rule, the server rewrites `cardURL` server-side (so prerendered HTML, scoped CSS, and head fragments come from the _target_ card), and the same routing map is injected into `@cardstack/host/config/environment` so the SPA's `index` route resolves the path synchronously post-hydration via `hostModeService.resolveRoutedPath()`. The pages don't know they're routed — they're plain CardDef instances, each free to be moved or renamed without breaking links because the public URL is decoupled from the card id.

A **same-realm guard** at read time enforces that `instance` points to a card in the same realm: a malicious realm owner can't point `/pricing` at a private realm's card and surface its prerendered HTML through their public URL.

## The `realm.json` shape

`realm.json` is a card instance of the base `RealmConfig` CardDef. Routing rules live in the `hostRoutingRules` field. Because each rule's `instance` field is `linksTo(CardDef)`, the actual link targets sit under `relationships` keyed by field path — **not** inline in `attributes`:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "cardInfo": { "name": "My App Realm" },
      "hostRoutingRules": [
        { "path": "/" },
        { "path": "/about" },
        { "path": "/blog" },
        { "path": "/pricing" },
        { "path": "/whitepaper" }
      ]
    },
    "relationships": {
      "hostRoutingRules.0.instance": {
        "links": { "self": "./Home/index" }
      },
      "hostRoutingRules.1.instance": {
        "links": { "self": "./AboutPage/about" }
      },
      "hostRoutingRules.2.instance": {
        "links": { "self": "./BlogIndex/blog" }
      },
      "hostRoutingRules.3.instance": {
        "links": { "self": "./PricingPage/pricing" }
      },
      "hostRoutingRules.4.instance": {
        "links": { "self": "./WhitePaper/launch-2026" }
      }
    },
    "meta": {
      "adoptsFrom": {
        "module": "https://cardstack.com/base/realm-config",
        "name": "RealmConfig"
      }
    }
  }
}
```

After publishing the realm at `https://my-app.com/`, the URLs above become live:

- `https://my-app.com/` → renders the `Home/index` card
- `https://my-app.com/about` → renders the `AboutPage/about` card
- `https://my-app.com/blog` → renders the `BlogIndex/blog` card
- (etc.)

Each rule's `instance` accepts:

- A **relative** reference (`./BlogIndex/blog`) — recommended; portable across realm URL changes.
- An **absolute** URL within the same realm.

Cross-realm references are silently filtered at read time. The realm-server logs a warning when this happens.

## End-to-end request flow

When a visitor hits `https://my-app.com/blog`:

1. **Realm-server** (`packages/realm-server/handlers/serve-index.ts`) receives the GET.
2. Calls `realm.getHostRoutingMap()` → reads the indexed `RealmConfig` card's `hostRoutingRules`, resolves relative refs to absolute URLs, drops cross-realm entries via the same-realm guard.
3. Finds rule for `/blog` → rewrites `cardURL` to `https://my-app.com/BlogIndex/blog`.
4. Fetches the prerendered isolated HTML, head, and scoped CSS for the _target_ card.
5. Injects them into the index.html response. The `@cardstack/host/config/environment` meta tag is per-request rewritten with `hostRoutingMap` — each rule's path prefixed with the realm's mount pathname so the client side sees direct-equality paths.
6. Visitor's browser hydrates the Ember SPA.
7. SPA's `index` route catches the path (`/blog`), calls `hostModeService.resolveRoutedPath('/blog')`, which checks `config.hostRoutingMap` and returns the target card id.
8. SPA loads the target card from the store; no flash, no network roundtrip — the prerender already painted it.

The server-side rewrite is what makes the first paint correct. The client-side `resolveRoutedPath` is what keeps client-side navigation (back/forward, in-app link clicks) consistent.

## Authoring workflow

Three steps:

1. **Build the page cards** as normal CardDefs. No special interface, no markers — just regular cards. Most page cards want `prefersWideFormat = true` and a brand-driven `cardTheme` (see [`theme-first-workflow`](../theme-first-workflow/README.md)).
2. **Save them in the realm** with stable, human-readable ids (e.g. `Home/index`, `BlogIndex/blog`). The id forms the relative reference under `hostRoutingRules.<i>.instance.links.self`.
3. **Edit `realm.json`** (or use the in-app realm config editor) to add the rules. Save. The realm indexes the change and the routing map is live on the next request.

Editing `realm.json` directly is the boxel-cli path:

```bash
npx boxel realm pull <realm-url> ./my-realm
# edit ./my-realm/realm.json
npx boxel realm push ./my-realm <realm-url>
```

The in-app path is the realm config editor (the UI guard in CS-10052 enforces same-realm `instance` selection so you can't point at a private realm by mistake).

## Common configurations

**Single-page marketing site:**

```json
"hostRoutingRules": [
  { "path": "/" }
]
```

With `hostRoutingRules.0.instance.links.self = ./Home/launch-page`. The entire site is one card at one URL.

**Multi-page app card (recommended starting shape):**

```json
"hostRoutingRules": [
  { "path": "/" },
  { "path": "/about" },
  { "path": "/pricing" },
  { "path": "/contact" }
]
```

Each path → a dedicated CardDef instance. Add a nav bar to each page (or to a shared layout card composed in via `<@fields.layout />`).

**Blog with index + posts:**

```json
"hostRoutingRules": [
  { "path": "/" },
  { "path": "/blog" }
]
```

The blog post pages are accessed via their card URLs (e.g. `/BlogPost/welcome-to-2026`) — you don't need a rule per post. The `/blog` rule renders the index card (which uses `@context.searchResultsComponent` to list posts). Individual post pages still have card-id-based URLs and look unstyled in the URL bar; live with it, or use the next pattern.

**Pretty-slug-per-post (still requires a rule per post — no wildcards):**

```json
"hostRoutingRules": [
  { "path": "/" },
  { "path": "/blog" },
  { "path": "/blog/welcome-to-2026" },
  { "path": "/blog/why-cards" },
  { "path": "/blog/launch-recap" }
]
```

With each `instance` linking to the corresponding `BlogPost` card. **There's no path-parameter syntax (`/blog/:slug`)** — every public URL has to be an explicit rule. For high-volume blogs, consider a build-time generator that regenerates `realm.json` from your post index.

## Gotchas

- **Static paths only.** No `/blog/:slug`, no `/products/*`, no regex. Each public URL is a literal `path` string. For dynamic-feeling URLs (e.g. blog posts) either enumerate every rule or live with id-based URLs for the leaf pages.
- **Same-realm only.** The `instance` reference must resolve to a card in the realm whose `realm.json` declares the rule. Cross-realm references are dropped at read time with a warning. Reason: a malicious realm owner could otherwise point `/pricing` at a private realm's card and surface its prerendered HTML through their public URL.
- **Public permissions required.** Host-mode routing only applies when the realm is reachable by anonymous visitors. A non-public realm 401s before the routing-map lookup happens (`serve-index.ts` checks `hasPublicPermissions(routedRealm, ...)` first).
- **Card must be saved.** `instance` is `linksTo(CardDef)`, which needs an id. Unsaved drafts won't route.
- **Trailing-slash handling has a recent fix** (commit `3e167af246`). If you're seeing `/blog/` route correctly but `/blog` not, make sure your boxel deployment is at or past 2026-05-21.
- **The routing map is read from the indexed searchDoc.** A rule added to `realm.json` doesn't take effect until the realm re-indexes that file. `npx boxel realm push` triggers it; if you edit via the in-app editor, the save handles indexing.
- **Path collisions silently lose to the first match.** If two rules share a path, `getHostRoutingMap` returns both and the consumer uses `.find()`, so the _first_ wins. Don't rely on that — keep paths unique.
- **No fallback chain.** If no rule matches the path, the request falls through to the standard card-URL resolver (`<host>/<path>` interpreted as a card id). For a published site, that usually means a 404. Add a `path: "/"` rule explicitly even if you don't think you need it — without it, the bare host URL renders the CardsGrid index card, which is rarely what a marketing site wants.
- **CardsGrid prerender opt-in.** The default `RealmConfig` includes `includePrerenderedDefaultRealmIndex: false` — the realm's default CardsGrid isolated HTML is skipped on indexing to save wall-clock. Routed sites can leave this off (the routed `path: "/"` rule supplies the home card directly). Set to `true` only if you actually serve the realm's default index card as `/`.

## Source

- Realm config CardDef: `packages/base/realm-config.gts` → `RoutingRuleField` + `RealmConfig.hostRoutingRules`.
- Realm-server read path: `packages/runtime-common/realm.ts` → `getHostRoutingMap()`. Resolves relative refs, drops cross-realm refs.
- Server-side request rewrite: `packages/realm-server/handlers/serve-index.ts` → matches the path against the routing map, rewrites `cardURL`, and injects the host-prefixed map into the config meta tag.
- Client-side hydration path: `packages/host/app/services/host-mode-service.ts` → `hostRoutingMap` getter + `resolveRoutedPath()`; called from `packages/host/app/routes/index.gts`.
- Tests / fixtures: `packages/realm-server/tests/realm-routing-test.ts` (the test fixture is the cleanest concrete example of the `realm.json` shape).
- Key commits:
  - `3c01ee3db4` _Add host mode routing from realm.json (#4709)_ — the main one
  - `7f5c8e4ca0` _Simplify host routing rules to URL-only references_
  - `3e167af246` _Fix host mode routing without trailing slash (#4915)_ — recent fix

## Local development / preview

Host mode normally only applies on `*.boxel.host` (or whatever the deployment's host-mode origin is). For local realm development:

- Run `npx boxel realm push` to land the `realm.json` update into the realm-server's index.
- Visit `https://<realm-url>/_path/` in the operator UI to confirm the rule resolved (the URL bar will show the routed-to card id).
- The full host-mode UX only kicks in when the realm is actually published (or when `config.simulatingHostMode` is on, which is a host-app dev flag).

For end-to-end test coverage, see `packages/matrix/tests/host-mode.spec.ts` — the spec exercises the published-realm path with realm-json routes.

## See also

- [`app-card-home-with-search`](../app-card-home-with-search/README.md) — the Home card pattern that pairs naturally with a `/` route. Build your Home CardDef first, then add the routing rule.
- [`theme-first-workflow`](../theme-first-workflow/README.md) — every routed page card wants a brand-driven theme.
- [`show-card-list-with-views`](../show-card-list-with-views/README.md) — for the index card of a `/blog` route.
- [`integrate-screenshot-card-format`](../integrate-screenshot-card-format/README.md) — auto-generate Open Graph images for each routed page (use the rule's target card id as the screenshot subject).
- The base CardDef: `https://cardstack.com/base/realm-config` (`RealmConfig` + `RoutingRuleField`).
