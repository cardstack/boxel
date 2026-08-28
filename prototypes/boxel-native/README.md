# Boxel native prototype

Offline messenger + lite SQLite indexer. NativeScript 9.1 iOS / Mac Catalyst is the target; this folder runs the same data plane locally without Xcode.

## Run locally

From this directory:

```bash
node web-simulator/server.mjs
```

Computed fields (`_title`, `fullName`, `initials`, `handle`) are evaluated at index time and stored on `boxel_index.search_doc`. Search is `json_extract` against that column only — the JSON files on disk are not queried. The Cards tab shows index hits vs a contrast JSON-file scan so a query like `@maple.grove` or `MG` is visibly an index hit and a source miss.

```bash
node --test tests/core.test.js
```

## Matrix

On a real device this messenger should be **matrix-sdk-rust** (UniFFI, SQLite store), not `matrix-js-sdk`. The `rooms` / `messages` tables here stand in for that store. See `docs/nativescript-offline-messenger.md`.
