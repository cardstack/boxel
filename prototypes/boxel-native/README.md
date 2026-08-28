# Boxel native prototype

Offline messenger + lite SQLite indexer. NativeScript 9.1 iOS / Mac Catalyst is the target; this folder runs the same data plane locally without Xcode.

## Run locally

From this directory:

```bash
node web-simulator/server.mjs
```

Then open http://127.0.0.1:4173/

The page is an iPhone chrome around `node:sqlite`: realm JSON files on a virtual disk, lite `boxel_index`, queued chats, then `boxel realm sync --prefer-newest` classify/push/pull against a simulated remote.

```bash
node --test tests/core.test.js
```

## Matrix

On a real device this messenger should be **matrix-sdk-rust** (UniFFI, SQLite store), not `matrix-js-sdk`. The `rooms` / `messages` tables here stand in for that store. See `docs/nativescript-offline-messenger.md`.
