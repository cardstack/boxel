# Live Tests (Card-Based)

Live tests run directly against a realm server. Test modules are `*.test.gts` files inside a realm that export a `runTests()` function — files must follow this naming pattern to be auto-discovered via the realm's `_mtimes` endpoint.

## Run in Browser

Requires servers to already be running.

- Experiments realm: `https://localhost:4200/tests/index.html?liveTest=true&realmURL=https://localhost:4201/experiments/&hidepassed`
- Catalog realm: `https://localhost:4200/tests/index.html?liveTest=true&realmURL=https://localhost:4201/catalog/&hidepassed`

## Run as a Script

Requires realm servers to be running (experiments + catalog). If you already have `pnpm start:all` running, that is sufficient.

```sh
# Terminal 1 — start realm servers if not already running
mise run test-services:host

# Terminal 2 — run the default live test suite (catalog realm)
cd packages/host
pnpm test:live

# Or target a specific realm via the REALM_URL env var (trailing slash optional)
REALM_URL=https://localhost:4201/experiments/ pnpm test:live
```
