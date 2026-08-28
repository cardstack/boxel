# NativeScript iOS / Mac messenger on the SQLite indexer path

This document records whether a NativeScript iOS app (and a Mac app via Mac Catalyst) can reuse Boxel's existing **filesystem → indexer → SQLite** path, with a Matrix-style messenger and later sync that matches `boxel realm sync`.

The working prototype lives in `prototypes/boxel-native/`. It is a proof of the *data plane*, not a replacement for the Ember host.

## Verdict

**Yes for the data plane. No for full card execution/render.**

The pieces that already exist and can run on-device:

| Surface | What exists today | What a native app can reuse |
| --- | --- | --- |
| Card storage | Realm files on disk (JSON:API instances + modules) | App Documents / shared container as the local realm directory |
| Index | `boxel_index` schema; query engine is SQLite-first | Native SQLite (`@nativescript-community/sqlite`) with the same table shape |
| Host SQLite adapter | `@sqlite.org/sqlite-wasm` in the browser host | Same SQL dialect; swap the adapter, keep the schema |
| Sync | `packages/boxel-cli/src/lib/sync-logic.ts` — classify local/remote, conflict flags | Identical functions on-device; push/pull against realm-server when online |
| Messenger | Host uses `matrix-js-sdk`; Element X uses `matrix-sdk-rust` | Native app uses **matrix-sdk-rust** (SQLite store + UniFFI). Host keeps JS. |

The pieces that **do not** fit on a phone/Mac Catalyst process:

- The production indexer walks files, then **renders** each card through the headless prerenderer (Chromium + built host app) to produce `search_doc`, HTML formats, and deps. See `docs/indexing.md`.
- Card modules are Glimmer/Ember (`CardDef` in `.gts`). NativeScript UI cannot load those modules as native views without the host execution runtime.
- `matrix-js-sdk` is the browser SDK. It is the wrong client on NativeScript (see Matrix client below).

So the native app's indexer is a **lite indexer**: parse JSON:API files from the filesystem, write `pristine_doc` + a field-level `search_doc` into `boxel_index`, and skip prerender HTML. Search, open-as-JSON, attach-to-message, and sync all work. Isolated/embedded card *rendering* stays a host (or later Sandbox) concern.

## Recommended native architecture

```
┌─────────────────────────────────────────────────────────────┐
│  NativeScript UI (iOS + Mac Catalyst)                       │
│  Chats · Cards · Sync                                       │
└────────────┬──────────────────────────┬─────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────────┐   ┌───────────────────────────────┐
│  Local realm directory │   │  boxel-index.sqlite           │
│  (card JSON files)     │──▶│  lite indexer → boxel_index   │
└────────────┬───────────┘   │  matrix.sqlite                │
             │               │  matrix-sdk-rust (UniFFI)     │
             │ lite indexer  └───────────────────────────────┘
             ▼  when online
┌────────────────────────────────────────────────────────────┐
│  File sync: boxel realm sync (hashes, _mtimes, manifest)   │
│  Message sync: matrix-sdk-rust sliding sync → Synapse      │
└────────────────────────────────────────────────────────────┘
```

Three runtimes share one TypeScript core (`prototypes/boxel-native/core/`):

1. **Node + `node:sqlite`** — this prototype's server (and unit tests). Proves the SQLite path without Xcode.
2. **NativeScript iOS** — `@nativescript-community/sqlite` talking to the OS SQLite. Same SQL.
3. **Mac** — not a separate NativeScript desktop target. Ship the iOS app through **Mac Catalyst** (`@nativescript/ios` already carries Catalyst build support). One binary family, one Documents-directory realm.

## Why SQLite is the right on-device store

The index query engine (`packages/runtime-common/index-query-engine.ts`) is designed so **SQLite is the floor**. Postgres mirrors SQLite's `json_tree` with `jsonb_tree`; the host already runs the same schema in-process via `packages/host/app/lib/sqlite-adapter.ts`. An iOS SQLite file is not a fork of the data model — it is the model the query engine already compiles to.

A lite indexer writes the same `boxel_index` columns the host/schema file defines (`url`, `file_alias`, `type`, `realm_url`, `pristine_doc`, `search_doc`, `types`, `display_names`, `generation`, …). When the device later syncs files up, the *server* re-indexes through the prerenderer and replaces the lite `search_doc` with the full rendered one. The device does not need Chromium for that.

## Matrix client: rust on device, JS in the host

**NativeScript iOS / Mac Catalyst: `matrix-sdk-rust` (the UniFFI FFI, same stack as Element X). Do not ship `matrix-js-sdk` there.**

The host, VS Code tools, and Playwright matrix tests stay on `matrix-js-sdk`. That is the browser/Node client this repo already patches and mocks. Two clients against one Synapse is the Matrix model (Element Web + Element X already do this). Card attachments stay `m.room.message` / `app.boxel.*` event JSON either SDK can send.

Why rust on the device:

| Constraint | `matrix-js-sdk` | `matrix-sdk-rust` |
| --- | --- | --- |
| On-device store | IndexedDB / memory. NativeScript has neither as a first-class store. | SQLite state + crypto store. Same disk model as `boxel_index`. |
| Crypto | Rust crypto compiled to WASM (`matrix-sdk-crypto-wasm`). NativeScript V8 is `--jitless`; WASM Olm/vodozemac on that path is the slow, fragile option. | Native vodozemac via UniFFI. No WASM. |
| Sync | JS `/sync` or sliding-sync helper; host already wraps this. | Sliding sync is native; built for resume-after-offline. |
| NativeScript 9.1 fit | Runnable in theory now that 9.1 has `AbortController`, `TextEncoder`, `URL`, `fetch`-class globals, and a real event loop — still a browser SDK on a jitless embedder. | Call the iOS XCFramework from TypeScript. 9.1's pitch is that the platform SDK *is* the API; UniFFI-generated ObjC/Swift is that. Node-API is the fallback if a `napi` wrapper is easier than raw interop. |
| Mac | Would need the same JS+WASM stack under Catalyst. | Same XCFramework slice Catalyst already uses; 9.1's Catalyst metadata generation is what makes those UIKit types show up. |

Keep **two SQLite files** in the app container, not one mashed schema:

- `boxel-index.sqlite` — lite indexer (`boxel_index`, realm file hashes, sync manifest)
- `matrix.sqlite` — rust SDK store (rooms, timeline, crypto)

A card attached to a chat is a Matrix event whose content points at a realm URL / file alias. File bytes move through `boxel realm sync`, not through Matrix, except when the host already uploads media to Matrix (local `FileDef` attach). The native messenger should follow that split.

Do not take the Element Web hybrid (JS client + rust-crypto WASM). On NativeScript that is the worst of both: a JS sync loop and WASM crypto on jitless V8.

The prototype's `rooms` / `messages` tables are a stand-in for `matrix.sqlite`, not a port of `matrix-js-sdk`.

## Offline messenger + cards

The host messenger is Matrix. A native offline-first cut uses matrix-sdk-rust's SQLite store for rooms and timeline. The prototype fakes that with `rooms` / `messages` tables until the UniFFI client is wired.

- optional `card_url` on a message (a `boxel_index.url` / file alias)
- outbound `sync_state`: `local` → `queued` → `synced` (rust SDK local-echo fills this role later)

Cards are not a second database. Opening a card is: read the realm file, show `pristine_doc` (and later, when online, the prerendered HTML from the server if you want host-fidelity). Attaching a card to a chat is storing that URL. Creating a card is writing a JSON:API file into the realm directory and running the lite indexer on that path — the same "filesystem to indexer" loop the realm server uses, without the render visit.

When the device is online, two independent syncs fire:

1. **Files** — `boxel realm sync` semantics (hash + mtime + manifest, `--prefer-local` / `--prefer-remote` / `--prefer-newest`).
2. **Messages** — matrix-sdk-rust sliding sync + send, with `matrix.sqlite` as the cache.

They must not be one job. File sync is realm-server; message sync is Synapse. A card attachment is just metadata that becomes meaningful after file sync has uploaded the instance.

## NativeScript vs wrapping the host in a web view

Wrapping `packages/host` in a WKWebView (Capacitor, Cordova, or NativeScript WebView) would give full card render, but it is not the SQLite/filesystem path this design is about, and it is a poor offline story (the host indexer still expects a prerenderer). NativeScript native UI + SQLite + a realm directory is the honest mapping of "use the sqlite path."

Mac: NativeScript does not ship a first-class AppKit target. Catalyst is the supported way to run the same iOS UI on macOS. A later Electron/Tauri shell could reuse the same `core/` against `better-sqlite3` if Catalyst UX is not enough.

## What the prototype proves

`prototypes/boxel-native/` runs a single process that:

- keeps a virtual realm filesystem of JSON:API cards
- indexes those files into an in-memory SQLite `boxel_index` (lite `search_doc`)
- searches/opens cards from that index
- hosts a messenger whose messages can attach indexed cards
- queues file changes while "offline" and applies `sync-logic` against a simulated remote when "online"

The web page is an **iPhone chrome** around that process so the flow is visible without Xcode. On a Mac, `ns run ios` against `nativescript-app/` is the same core behind native widgets.

## Out of scope for a first native cut

- Loading `.gts` card modules or running Glimmer in NativeScript
- Prerender HTML / computed-field evaluation that requires the host
- Real Matrix login (the prototype uses a local event log standing in for matrix-sdk-rust)
- Real realm-server HTTPS (the prototype uses an in-process remote map; wiring `RealmSyncer` is a follow-up)
- Android (same core would work; not exercised here)
