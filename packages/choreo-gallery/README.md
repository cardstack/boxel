# Boxel gallery build

`test-app/app` remains the canonical gallery. This private package generates
the Boxel adaptation; do not edit copied demos, notes, catalog, or styles here.
The generated copies and media are gitignored. Shared film engine fixes live
in `packages/glimmer-motion`, so the normal gallery benefits too.

## Rebuild

From the monorepo root:

```sh
pnpm build:boxel
pnpm --filter choreo-gallery lint:types
pnpm --filter choreo-gallery test:realm
pnpm --filter choreo-gallery test:boxel
```

`sync-gallery.mjs` copies the current demos and applies the host adapters.
`scope-css.mjs` constrains gallery CSS and plain component style blocks to
`.choreo-site`, preserving cross-component selectors without leaking into Boxel.
`build-boxel-realm.mjs` emits `dist-realm/`, including a content-addressed
runtime, all catalog cards, host routes, media, and a separate iframe app.
The ordinary Pages build is unchanged unless `CHOREO_BOXEL_BUILD=1`.

Mockup and Long Take stay in the main DOM. Towers, Sagrada, and Sylva use
raw-document frames; HTML is fetched as card source, not navigated through
Boxel's HTML file viewer. The two films pass their model HTML through the
shared picture API's `srcdoc` option. Their assets resolve inside `iframe/`.
The iframe's Vite chunks use `.mjs` to avoid realm-module transformations.
Main-DOM Draco decoder source is likewise fetched as a raw `.txt` asset before
Three creates its worker; it must not contain Boxel loader instrumentation.

## Publish and compare

Source realm: https://realms-staging.stack.cards/ctse/complex-macaw/

Unlisted host: https://ctse.staging.boxel.dev/2pvv46wbmjdsr8dy/

Reference: https://cardstack.github.io/choreo/

Before pushing, cancel running and pending source indexing. Push without
deleting remote files, POST the normal `_reindex`, then publish to the existing
unlisted host. Wait for readiness: a publish acceptance is not proof that all
pages have finished indexing. The generated `robots.txt` requests no indexing;
unlisted does not mean private or access-controlled.

Run browser checks with audio muted:

```sh
node packages/choreo-gallery/scripts/compare-hosts.mjs https://ctse.staging.boxel.dev/2pvv46wbmjdsr8dy/
node packages/choreo-gallery/scripts/compare-hosts.mjs https://cardstack.github.io/choreo/
```

Playwright Chromium must be installed (`pnpm exec playwright install chromium`
from this package). Browser checks cover a smoke-test subset, not exhaustive
visual or interaction parity across every demo.
