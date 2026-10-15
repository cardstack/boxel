---
name: choreo-create
description: Recreate or combine the Choreo gallery's demos (packages/choreo-gallery) into Glimmer interfaces, spatial scenes and films, or add live tuning and focused teaching examples.
---

# Build from real Choreo examples

The gallery's catalog is `packages/choreo-gallery/realm/demos/<id>.json`, one
`GalleryDemo` card per demo (title, group, API pills, usage sample, walkthrough,
lesson). Each demo adopts from its stage,
`packages/choreo-gallery/realm/stages/<id>.gts`, and a demo with a Deep Dive
has its note in `packages/choreo-gallery/realm/notes/<id>.gts`. Read the
selected example before adapting it. Imports use `glimmer-motion`,
`@cardstack/choreo`, `@cardstack/choreo/film`, or the separate
`@cardstack/choreo-player` package; verify unfamiliar APIs against exported
source (`packages/glimmer-motion/src/index.ts`, `packages/choreo/src/index.ts`).

## Choose only the guidance needed

- For an animation pattern, read `.claude/skills/motion-pattern/SKILL.md`, then
  its selected specialist. The shared Glimmer invariants are the three rules in
  `motion-element`; do not repeat them in every implementation note.
- For gates, derived motion, commands, delivery or custom vocabulary, read
  [advanced-orchestration.md](references/advanced-orchestration.md).
- For camera coordinates, live DOM projection, picture actors or film clocks,
  read [spatial-and-film.md](references/spatial-and-film.md).
- For combining examples into an application or narrative, read
  [composition-recipes.md](references/composition-recipes.md).
- For DialKit, presets or capture mechanics, read
  [tuning-and-recording.md](references/tuning-and-recording.md).

Identify the semantic state, participant identities, property owners and clock
before composing. Reuse the existing implementation rather than constructing a
second preview-only motion system. Keep shared variables shared and independent
transitions independent. Preserve user input during interruptible movement.

## Teaching and tuning

Every gallery demo carries a `lesson` (concept guide, why, experiment, pitfall,
composition idea) in `packages/choreo-gallery/realm/demos/<id>.json`. The
concept guides are `packages/choreo-gallery/realm/docs/guides/*.md`.
`packages/choreo-gallery/tools/api-inventory.json` maps public APIs to concept
guides; look up the relevant entries rather than loading it whole. For a
tutorial, isolate one observable relationship and predict the result of a
parameter change. The docs-only spatial/film studies in
`packages/choreo-gallery/realm/design/docs-studies-plan.md` are planned, not shipped.

Every control must supply a named variable consumed by that example. Show units,
use meaningful ranges, and retain source defaults. Each demo page's lab
(`packages/choreo-gallery/realm/shell/lab-panel.gts`) puts those variables on a
DialKit panel beside the demo's authored presets. An edit reaches the demo as it
renders; motion already in flight keeps its timing until the demo moves again,
so the lab's replay runs it from the start with the new values.

Verify the relevant behaviour: first interaction, mid-flight change, reset and
teardown; for captured output, compare the same time reached by different paths.
Use the motion test helpers (`motion-testing`) and run `pnpm lint:realm` in
`packages/choreo-gallery` for teaching coverage: it checks the API inventory
against the libraries' exports, every demo's lesson, and the guides. Do not treat a word count or an embedded demo as proof of understanding.
