---
name: choreo-create
description: Recreate or combine this repository's Choreo demos into Glimmer interfaces, spatial scenes and films, or add live tuning and focused teaching examples.
---

# Build from real Choreo examples

Use `test-app/app/lib/catalog.ts` to resolve demo IDs to components, source samples
and notes. IDs are not always filenames: `far` is `far-match`, `pointer` is
`follow-pointer`, and `presence` is `presence-modes`. Read the selected example
before adapting it. Imports use `glimmer-motion`, `@cardstack/choreo`, `@cardstack/choreo/film`, or the
separate `choreo-player` package; verify unfamiliar APIs against exported source.

## Choose only the guidance needed

- For an animation pattern, read `.claude/skills/motion-pattern/SKILL.md`, then
  its selected specialist. Existing `AGENTS.md` contains the shared Glimmer
  invariants; do not repeat them in every implementation note.
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

`test-app/app/content/demo-lessons.json` maps every catalog demo to an explanation,
experiment, pitfall and composition idea. `docs/api-inventory.json` maps public
APIs to concept guides; look up the relevant entries rather than loading it whole.
For a tutorial, isolate one observable relationship and predict the result of a
parameter change. The docs-only spatial/film studies in
`docs/docs-studies-plan.md` are planned, not shipped.

Every control must supply a named variable consumed by that example. Show units,
use meaningful ranges, and retain source defaults. `/playground/:demo_id` uses
the shared workbench, including live edits and authored presets. A timing-only
edit and a new target require different engine handling; use the existing adapter.

Verify the relevant behaviour: first interaction, mid-flight change, reset and
teardown; for captured output, compare the same time reached by different paths.
Use the repository's motion test helpers and run `pnpm docs:check` for teaching
coverage. Do not treat a word count or an embedded demo as proof of understanding.
