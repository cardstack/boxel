# Agent handoff — wrap the plane prototype in an Electrobun app

You are taking over the planes-as-iframes prototype and lifting it from
one browser page to a **multi-window desktop app built on Electrobun**.
Chris's spec, verbatim intent:

1. Two Electrobun windows. Window 1 holds **Panel A and Panel B**;
   window 2 holds **Panel C and Panel D**. Cards drag between panels
   **across windows**, with the same carried-card visual and crossfade
   teleports as the browser prototype.
2. Dragging a card out of any window and releasing it **on the desktop**
   (over no window) creates a **new third window** containing a fresh
   **Panel E**, and the card lands in it. Tear-off, in other words.

## What already exists — read these first

- `docs/plane-frames-prototype.md` — the protocol and its three laws.
  This is the contract you are porting; do not redesign it.
- `test-app/app/components/plane-host.gts` — the host relay: PlaneLink
  (enveloped port messaging, confirmed requests with 3s timeouts),
  the carry state machine (begin → move → drop-target → adopt/land/reveal
  or cancel/restore), and the recovery path.
- `test-app/public/planes/plane.html` — the child document, all roles.
  The panel and overlay roles port nearly unchanged; only the transport
  edge and the coordinate basis change.
- `videos/choreo-sequence-reel/scripts/probe-planes.mjs` — the
  verification pattern: real input, assert ownership after every leg.
- Prior art for the protocol style: the boxel monorepo branch
  `sandbox-child-work` (worktree at
  `~/Projects/boxel/.claude/worktrees/agent-a3caf7bc22797575e`),
  especially `sandbox-surface-transport.ts` and
  `sandbox-runtime-process.ts`.
- Look and feel: **bento-boxel** (`~/Projects/bento-boxel/app/styles/app.css`
  tokens are already baked into `plane.html`). Keep it.

## Research FIRST, before designing anything

Electrobun (electrobun.dev, Bun main process + native webviews) is young
and its API surface moves. Pin down, from its current docs/source, with a
spike per question:

1. **Windows:** creating frameless/transparent/always-on-top windows;
   reading and setting window frames in **screen coordinates**;
   click-through (ignore mouse events) support.
2. **RPC:** the typed bun↔webview bridge — message shape, whether it can
   carry our envelopes verbatim (it should; they're plain JSON), latency.
3. **Global pointer position:** can the bun process read the screen-space
   mouse position during a drag (needed the moment the pointer leaves the
   source window's bounds — see the capture question below)?
4. **Pointer capture across the window edge:** in a native webview, does
   a captured pointer keep streaming `pointermove` with out-of-viewport
   client coordinates once the cursor leaves the OS window? Test this
   empirically on macOS before committing to the architecture. If yes,
   the browser prototype's gesture law survives whole. If no, fall back
   to the bun process polling the global mouse (question 3) while a drag
   is active.

## Architecture mapping (recommendation, adjust to what research finds)

- **The host relay moves to the bun main process.** PlaneHost's logic is
  transport-agnostic by design — port it, swapping MessagePort for the
  Electrobun RPC bridge. Envelopes, requestIds, timeouts, recovery: keep
  identical.
- **The wire law upgrades from page space to SCREEN space.** Each panel
  webview gets its rect in screen coordinates (window frame + webview
  offset, owned by the bun process, resent on window move/resize).
  `toPage`/`toLocal` become `toScreen`/`toLocal`; nothing else changes.
- **Plane 4 becomes a WINDOW, not an overlay layer.** The carried card is
  a small frameless, transparent, always-on-top, click-through window the
  size of the card; carrying = `setPosition` on every relayed move. This
  is the desktop-native tear-off pattern and it makes the third-window
  spec almost free: the card is already its own window mid-flight.
  (Fallback if frameless/transparent is weak: one overlay webview per
  window with a handoff at the boundary — uglier, document why if you
  land there.)
- **Hit-testing lives in the bun process:** it knows every window's
  screen frame; route `drag-over` to the panel containing the screen
  point; none → the current hover is the desktop.
- **Desktop drop:** spawn window 3 at the release point (card-window's
  current position, minus sensible chrome offsets), containing one fresh
  panel initialized as **PANEL E**; run the normal adopt/land/reveal
  sequence against it once it connects. Reuse the connect handshake —
  a window that hasn't announced within the confirm timeout fails the
  drop like any other silent plane (recovery: restore to source).
- Panels stay the same child code, initialized with tags A/B (window 1)
  and C/D (window 2); E is the tear-off panel. Card set: seed A with two
  cards, C with one, as in the prototype.

## Where the code goes

New top-level directory **`planes-desktop/`** in this repo (glimmer-motion),
its own package.json (Bun/Electrobun), not wired into the pnpm test-app
build. Copy `plane.html` in and adapt; don't import across.

## Definition of done

A probe in the spirit of `probe-planes.mjs` — scripted if Electrobun
allows synthetic input, a written manual checklist with screenshots if
not:

1. A→C (cross-window) lands; C's document owns the card, A's does not,
   the card window is gone.
2. C→B (reverse direction, other window) lands.
3. Release over the desktop → window 3 appears with PANEL E owning the
   card; drag it from E back to A.
4. Release over a window but no bay → cancel: card flies home, restored.
5. Kill one window mid-drag → recovery: source restored, no orphan card
   window. (The confirm-timeout machinery should make this nearly free.)

Record a short screen capture of legs 1–3 for Chris. If anything jitters,
apply his loop protocol: record the same drag 4 times and diff the
relative positions across takes.

## Working rules (standing, from Chris)

- **No PRs** — commit on a branch and push; Chris merges. Never
  `git add -A`; stage named files. Commit style: narrative-sentence
  title + prose body + `Co-Authored-By: Claude Fable 5
<noreply@anthropic.com>`.
- Red-first tests where the harness allows; probes where it doesn't.
- Features must be equally valuable in live interactive apps — no
  recorder-only or demo-only hacks.
- When it runs, send Chris the dev/app instructions for his own pass
  before calling it done.

## Open questions to surface early (don't guess silently)

- Electrobun maturity risks: packaging, macOS-only features, webview
  engine (WKWebView vs Chromium) — WAAPI/`scale` keyframe support in
  WKWebView needs a quick check (the overlay's lift/fly animations).
- Whether window-2's panels C/D should be a second instance of the same
  two-panel layout (recommended) or one four-panel window pair.
- Multi-display coordinate spaces (negative screen coords on macOS with
  a display left of the main one) — the screen-space law must survive it.
