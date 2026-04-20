# Fix: Prefix-form card IDs crashing multiple catalog workflows

## Problem

The backend stores card IDs as a portability shorthand (prefix form), e.g.:

```
@cardstack/catalog/piano/Piano/abc123
```

instead of the absolute URL the frontend needs:

```
http://localhost:4201/catalog/piano/Piano/abc123
```

The frontend was passing these prefix strings directly to `new URL()` and `new Request()`, which only accept valid URLs. This caused `TypeError: Invalid URL` crashes that broke **all catalog-realm card interactions**:

- **spec-preview** — completely broken when viewing any catalog card
- **Create card / Create listing** — crashed on save, card never appeared in store
- **Delete card** — crash trying to build the delete request URL
- **Remix** — crashed opening the remix panel for a catalog card
- **View card / click to open** — crashed navigating to any catalog card

## Root cause

There were **five distinct entry points** where prefix-form IDs entered the frontend without being resolved. No single fix covered all of them — each entry point bypassed the others.

## Fix strategy

Rather than adding guards in every affected component (dozens of call sites), the fix resolves prefix form **at the highest possible upstream point** for each entry path. Downstream components like `spec-preview` require no changes — they keep their existing `new URL(card.id)` calls, which now always receive a valid absolute URL.

**All fixes are frontend-only, in-memory. The database is never touched — it intentionally keeps prefix form for portability.**

## Fixes

| # | File | Entry point fixed | Why this location |
|---|---|---|---|
| 1 | `virtual-network.ts` | Prefix string passed as a `fetch()` URL | Every network call goes through here; intercept before `new Request()` is built |
| 2 | `store.ts` `createFromSerialized` | `resource.id` / `included[].id` from server HTTP response | Normalize before card API hydrates JSON into a card instance — `card.id` is always absolute after this |
| 3 | `store.ts` `persistAndUpdate` | `json.data.id` returned by server after save | Normalize immediately after save response; prevents false-positive `needsServerStateMerge` and wrong `api.setId` |
| 4 | `code-ref.ts` `identifyCard` | `codeRef.module` from Loader's internal identity map | Loader stores module paths as prefix internally; resolve once here so all 8+ callers automatically get absolute module paths |
| 5 | `operator-mode-state-service.ts` `deserialize` | Trail card IDs read from localStorage / URL hash | Persisted state bypasses all runtime fixes above; `normalizeTrailItem` resolves on read, drops corrupt entries |
| 6 | `routes/module.ts` `buildModuleModel` | Module `id` from browser URL query string | Route parameter enters the app before any store or Loader processing; `cardIdToURL(id)` replaces `new URL(id)` |

## Key utility

```typescript
// card-reference-resolver.ts
cardIdToURL("@cardstack/catalog/piano/Piano/abc123")
  → new URL("http://localhost:4201/catalog/piano/Piano/abc123")  ✅

cardIdToURL("http://localhost:4201/catalog/piano/...")
  → passes through unchanged  ✅

// Always guard local IDs (unsaved cards) first:
if (!isLocalId(id)) { cardIdToURL(id) }
```
