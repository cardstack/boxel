# Live Tests (Card-Based)

Live tests run directly against a realm server. Test modules are `.gts` files inside a realm that export a `runTests()` function — they are auto-discovered via the realm's `_mtimes` endpoint.

## Run in Browser

Requires servers to already be running.

- Experiments realm: `http://localhost:4200/tests/index.html?liveTest=true&realmURL=http://localhost:4201/experiments/&hidepassed`
- Catalog realm: `http://localhost:4200/tests/index.html?liveTest=true&realmURL=http://localhost:4201/catalog/&hidepassed`

## Run as a Script

Requires realm servers to be running (experiments + catalog). If you already have `pnpm start:all` running, that is sufficient.

```sh
# Terminal 1 — start realm servers if not already running
mise run test-services:host

# Terminal 2 — run all realm test suites (catalog + experiments)
cd packages/host
pnpm test:live

# Or target a single realm
REALM_URL=http://localhost:4201/experiments/ pnpm test:live
```
