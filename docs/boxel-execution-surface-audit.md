# Execution-Tier Surface Audit — which host surfaces route through Capsule/Sandbox

Date: 2026-08-07. Companion to `boxel-rendering-protocol.md` and
`boxel-simplification-opportunities.md`.

`CardRenderer` routes a render through `BoxelExecutionRenderer` only when
`@execution='auto'` AND no `@field` AND no `@codeRef` is passed
(`card-renderer.gts:107`). Everything else renders through the direct
runtime — main's path, executing card code in the main document.

## Surfaces that route through the execution tiers today

| Surface                           | File                                        | Status               |
| --------------------------------- | ------------------------------------------- | -------------------- |
| Interact-mode stacks              | `operator-mode/stack-item.gts:1182`         | `execution='auto'` ✓ |
| Code-mode card-JSON preview panel | `operator-mode/preview-panel/index.gts:319` | `execution='auto'` ✓ |
| Host submode                      | `host-mode/card.gts:142`                    | `execution='auto'` ✓ |

## Surfaces that still render card code directly

Ranked by trust impact — "untrusted" means the surface can render cards from
realms the user has never opted into executing.

1. **Search sheet results** (`search/result-tile.gts`,
   `search/hydratable-card.gts`) — embedded-format renders of hits from _every
   subscribed realm_ (~250 on staging). This is the widest untrusted surface
   in the app; a malicious card def in any searchable realm executes in the
   main document the moment it appears in results. Highest-priority candidate
   for `execution='auto'` (needs the embedded/fitted formats to be cheap in
   the sandbox tier — prerendered records make this viable).
2. **AI-assistant room messages** (`matrix/room-message-tool.gts`) — cards
   attached to or produced by assistant messages render directly. Cards can
   arrive from other rooms/realms; should route through the tiers.
3. **Markdown card embeds** (`markdown-embed-chooser/preview/index.gts`,
   `preview-panel/rendered-markdown.gts`) — embedded renders of cards linked
   from markdown content. Content-driven, so effectively untrusted.
4. **Code-mode playground** (`code-submode/playground/playground-preview.gts`,
   4 call sites; also `instance-chooser-dropdown.gts`,
   `field-chooser-modal.gts`, `spec-preview.gts`) — renders the module the
   user is _actively editing_. Direct execution here matches the volatile
   model's trust story (author editing their own code) and is why the
   edit→preview HMR loop behaves identically to main. Leave direct for v1,
   but note nested `linksTo` cards from foreign realms also render direct
   here.
5. **`form` synthetic format in the preview panel** — passing
   `@codeRef=baseCardRef` (preview-panel `effectiveCodeRef`) silently opts
   the render OUT of the execution runtime even on a surface that otherwise
   routes auto. Inconsistent: a sandbox-tier card's "Toggle Standard View"
   renders direct. Fix direction: teach the execution renderer a
   base-template override instead of using `codeRef` as the escape hatch.
6. **Fitted format gallery / metadata panel** (`preview-panel/*`) — code-mode
   own-module context; low priority.
7. **Command runner route** (`templates/command-runner.gts`) — headless,
   server-invoked context; out of scope for the browser trust boundary.

## Verified behavior of the code-mode edit loop (2026-08-07)

Template edit → autosave → preview, measured side by side on the same card
(`ctse/forge-gym-shift-board/gym-shift-board.gts`, 810-line sandbox-tier
card):

- **This branch**: preview blanks during recompile, re-renders with the new
  template in ~5–10s. Selection stable. Same behavior on the corpus
  WordPuzzle (~4s).
- **Deployed staging main**: identical shape, ~15s to recover.

The blank-while-recompiling gap is main's inherited behavior (the module
recompile tears down the rendered component before the new one is ready),
not an execution-runtime regression. Candidate polish (upstreamable): keep
the last-known-good render mounted until the new module's render is ready —
the sandbox tier already has exactly this state (`renderedComponent` kept on
failed apply), so the tiers could _beat_ main here.

## Known main-lineage foot-guns observed during the audit (not this branch)

- `code-submode.gts onModuleEdit` rename-follow uses
  `isEquivalentBodyPosition`, which compares `loc.start.token` under a
  `@ts-expect-error`; if `token` is absent on both positions the comparison
  is `undefined === undefined` for any two class bodies. Suspicious; worth an
  upstream look.
- After a module save triggers a _file-resource reload_ (e.g. an invalidation
  whose clientRequestId the resource doesn't recognize), Monaco remounts and
  restores the cursor from `recentFilesService` — which can be a _stale_
  position from a previous session. The cursor-based declaration selector
  then jumps `codeSelection` to whatever declaration contains that old
  cursor, and if it's a FieldDef the playground auto-creates a Spec + example
  instance in the realm as a side effect. Observed on a main-lineage build;
  needs an upstream guard (don't auto-create specs from a selection change
  the user didn't make).
- Two open editors on the same realm file (any two hosts) fight via
  autosave: each tab's save invalidates the other, and a reload can revert
  the first tab's write within milliseconds. No last-writer-wins guard.
