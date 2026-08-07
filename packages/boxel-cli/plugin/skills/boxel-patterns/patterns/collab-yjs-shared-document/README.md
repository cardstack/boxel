---
validated: source-proven
---

# collab-yjs-shared-document — Real-time co-editing where everyone syncs, one identity commits

**What this gives you:** Live multi-user editing of a card-backed document (code/text field, or structured state like a shared 3D scene) using Yjs CRDTs — with the realm staying authoritative. Every participant syncs through a WebSocket relay; a single *committer* peer holding a realm JWT materializes the settled content back into the official card. Everyone can write; one identity records.

**When to use:**
- Collaborative code/text fields, a shared whiteboard-ish doc, or any "everyone edits, one identity commits" surface over realm cards.
- Structured shared state (camera position, object properties, table cells) that several browsers mutate concurrently.

When NOT to use:
- Contested business state — scarcity, arrival-order fairness, sealed bids, auction clocks, inventory decrements. CRDTs merge concurrent writes; they cannot arbitrate them. That state belongs to an ordered command kernel that admits one winner, with the CRDT plane (if any) carrying only the visible content.
- Ordinary card editing where last-save-wins is acceptable — the built-in edit format already handles that.

**The insight:** Authority is the pen, not the CRDT. The relay is just another Yjs peer and never needs a realm credential; the committing role is a separate outbound peer that runs wherever a CLI profile is authenticated. It seeds an empty room once from the official card, debounces document updates (a few seconds, with a hard cap), and writes the materialized text/JSON back to the realm under its own JWT. Realm permissions, audit, and indexing all keep working because every durable write is an ordinary realm write.

## Recipe shape

Three moving parts:

1. **Relay** — a y-websocket-compatible server (Node daemon, or a Cloudflare Worker + Durable Object with hibernatable WebSockets, one room per DO). Payload-agnostic: the same relay serves Y.Text and Y.Map rooms unchanged.
2. **Committer** — an outbound-websocket Yjs peer colocated with an authenticated `boxel` CLI profile. Seeds the room from the official card once, then commits settled content back (`boxel file read` / `boxel file write` or the equivalent client calls).
3. **Card-side client** — the collaborative card bundles yjs + y-websocket + y-indexeddb (+ editor binding) into a single ESM file served from the realm and imported by the card.

Load-bearing details:

- **Role enforcement lives in the relay's message loop.** Decode the Yjs message type yourself: for read-only connections, handle SyncStep1 but DROP SyncStep2/update messages — and reply with a fresh SyncStep1 so a locally-typed viewer converges back to the shared state. Relay awareness for everyone (read-only users still get colored cursors). Client-side, also set `EditorState.readOnly` + `EditorView.editable.of(false)`.
- **Auth preflight beats in-protocol auth.** A CORS-open `GET /auth?key=` before opening the provider gives clean UX (immediate editor/viewer role assignment); the websocket upgrade re-checks the key anyway. A wrong key should mean "join as viewer with a notice", not a reconnect loop.
- **Never re-seed a CRDT room by inserting text.** A daemon that re-seeds on restart under a new Yjs clientID makes returning replicas merge their old op history alongside — doubling the document. Persist the encoded doc state (Durable Object storage / a state file) so op history is the durable thing; seed-by-insert must be a once-ever event guarded by "doc is empty after initial sync". Y.Map keys are last-writer-wins, which relaxes this: a racing double-seed converges instead of doubling — still guard on `map.size === 0` after sync.
- **Skip the settle when the update origin is the seed transact**, or boot commits a no-op revision.
- **Don't reuse the host's CodeMirror** (`globalThis.__loadCodeMirror`) for yCollab — its context is markdown-wired, and extensions from a second `@codemirror/state` copy are rejected. Bundle codemirror + yjs together so module identities stay consistent.
- **Pick the Yjs type by shape, not habit.** Most card and surface editing does not need a bespoke CRDT: nested `Y.Map` for stable keyed objects and ordinary cells, `Y.Array` for meaningful order or repeated values, `Y.Text` for plain text, `Y.XmlFragment` (or an editor-native binding) for rich text. Keep cursors, selections, focus, and presence in **awareness**, not the doc. Keep file bytes, computed fields, schema/permissions, and command-owned invariants out of the map entirely.
- **Map values are peer-supplied input.** Validate every key on read (hex-regex colors, clamped numbers, allowlisted enums) in BOTH the card and the committer before they reach a renderer, inline styles, or the official card.
- **Split hot state from tracked state.** For pointer-rate updates (camera drag), the render loop reads a plain untracked object, flushed to the Y.Map via a throttled transact (~25 Hz); a tracked snapshot updates only from the map observer. Apply your own echo (`txn.local`) to slow UI state but NOT to the hot path, or the stale echo rubber-bands an in-flight drag.
- The `no-raf-for-state` lint rule fires on WebGL/canvas paint loops; the rule text itself sanctions an inline `eslint-disable-next-line @cardstack/boxel/no-raf-for-state` for genuine animation loops.
- `ws://localhost:<port>` is reachable from a published HTTPS boxel.site page (Chrome-family mixed-content exemption for the `localhost` hostname — `127.0.0.1` does not qualify). Fine for local development; deploy the relay behind `wss://` for real multi-device use.

**Boundary with the command plane:** Yjs is the collaborative *content* plane only. Ordered commands keep authority over contested outcomes; audit storage records attribution and outcomes; periodic whole-realm checkpoints provide restore. A snapshot-style writer (AI, sync) submits against an expected realm revision and rebases on conflict rather than forking a server-side head.

**Source:** Extracted from a live realm-collaboration POC workspace — a CodeMirror Y.Text pad settling into an official doc card, and a Three.js Y.Map scene settling into an official scene card, via y-websocket relay + committer daemons. Ask the user for the current realm URL if you want to read the originals.

## See also

- `resource-for-state` — wrapping stateful third-party library objects in a Resource.
- `integrate-three-js-via-cdn` — the renderer side of the Y.Map scene demo.
- `boxel/references/lint-workflow.md` — the lint gate to run before declaring the card done.
