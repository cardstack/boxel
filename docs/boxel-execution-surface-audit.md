# Execution-Tier Surface Audit — which host surfaces route through Capsule/Sandbox

Date: 2026-08-07. Companion to `boxel-rendering-protocol.md` and
`boxel-simplification-opportunities.md`.

Every top-level `CardRenderer` now routes through `BoxelExecutionRenderer` by
default. `@execution='direct'` is the explicit trusted/legacy escape hatch;
passing `@field` keeps a delegated field inside the parent render graph rather
than opening a second execution boundary. `@codeRef` is a standard-view Base
template override and does not bypass policy routing.

## Surfaces that route through the execution tiers today

All ordinary product surfaces now inherit automatic routing, including
interact-mode stacks, Host mode, search results, room-message cards, markdown
embeds, and card-JSON preview panels. This makes the safety property live at
the render entry instead of a manually maintained list of call-site flags.

## Deliberate Direct exceptions

1. **Code-mode playground** (`code-submode/playground/playground-preview.gts`,
   4 call sites; also `instance-chooser-dropdown.gts`,
   `field-chooser-modal.gts`, `spec-preview.gts`) — renders the module the
   user is _actively editing_. Direct execution here matches the volatile
   model's trust story (author editing their own code) and is why the
   edit→preview HMR loop behaves identically to main. Leave direct for v1,
   but note nested `linksTo` cards from foreign realms also render direct
   here.
2. **The protocol equivalence oracle** explicitly requests Direct in tests so
   the policy-routed Direct tier can be compared with main's legacy mount.

## Realm-mirror regression coverage

`rp-realm-mirror-compatibility-test.gts` indexes ordinary realm source and
instances, then renders them through an unannotated top-level `CardRenderer`.
It covers the combinations that have repeatedly exposed boundary gaps:

- nested `FieldDef` delegation and the trusted Base default edit surface;
- `linksTo` and `linksToMany` rendering, including format fallback;
- primitive Base fields, function-form `computeVia`, and presentation statics;
- isolated, embedded, fitted, and atom formats from one authored module;
- trusted Boxel UI and icon imports inside authored Capsule templates; and
- RichMarkdown card embeds plus the asynchronously loaded CodeMirror editor.

These are compact mirrors of real workspace patterns, not special protocol
fixtures. A failure is repaired in the shared runtime or trusted Base surface;
the suite does not add fixture-specific classification or serialization rules.

## Authenticated FileDef resource reads

A Sandbox has no ambient session credentials. Authored `fetch()` therefore
uses a Host-brokered, GET-only resource channel. Authority is exact and comes
from either a projected relationship link or the conventional scalar
`resourceUrl` field used by FileDef adapters when a polymorphic FileDef link
cannot be represented. Other URL-looking attributes do not grant access.

`resourceUrl` is a capability-bearing Boxel convention, not a generic network
escape hatch: the Host canonicalizes the one projected URL, strips the hash,
caps the response, and grants only that exact resource to that retained
Sandbox process. This is what lets private PDF, GLB, MIDI, and similar bytes
load without giving authored code a Store, Loader, session token, or ambient
realm search capability.

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
