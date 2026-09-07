---
name: choreo-create
description: Recreate or combine Choreo gallery demos into Glimmer applications, spatial interfaces, guided tours, and recorded films. Use when building from this repository's examples or adding live DialKit tuning to a Choreo scene.
---

# Build from Choreo's Real Demos

Work from this repository's implementation, not a visual imitation. The same package has four teaching sections: core glimmer-motion, interactive Choreo, spatial/3D Choreo, and recorded/film Choreo. Start at the smallest level that expresses the requested behavior.

## Find the Actual Example

Read `test-app/app/lib/catalog.ts` to resolve a demo's public ID to its component, source sample, and optional notes. Public IDs are not always filenames: `far` maps to `far-match.gts`, `presence` to `presence-modes.gts`, `pointer` to `follow-pointer.gts`, and `reorder` to `reorder-list.gts`.

Read the component and its matching `components/notes/` file before adapting it. The catalog and examples are the source of truth. The website's short explanations are in `test-app/app/content/guides/`; architecture documents can include proposals, so check their status and the exported implementation before treating an API as shipped.

Before writing motion, read `.claude/skills/motion-pattern/SKILL.md` and the pattern it selects. These paths are relative to the repository root, including when this skill is loaded through `.agents/skills/`.

## Check the API and Concept Inventory

Read `docs/api-inventory.json` and the relevant pages in `test-app/app/content/guides/` before composing unfamiliar features. The guides distinguish implemented behavior, advanced host contracts, and renderer capabilities. Use `pnpm docs:check` when changing public APIs or guide coverage. Keep the preview visible beside its parameter controls so experiments can be compared without scrolling the result away.

## Recreate the Behavior

Identify four things in the example: the state changed by the user, the identity of each participant, the properties owned by Motion, and the timeline or clock that coordinates them. Preserve those relationships when replacing demo content with the requested product.

- Import from `glimmer-motion`; Film's complete API lives at `glimmer-motion/film`. `choreo-player` is a separate transport package.
- Put motion-owned styles through `{{motion style=…}}`. A bound HTML style attribute can erase the engine's transform.
- Preserve stable IDs and yielded exit data. A leaving Glimmer block remains reactive.
- Use `c.Sequence` and `c.Parallel` for ordering. Do not add timer-based choreography or view-transition snapshots over live content.
- Preserve the user's reduced-motion preference, keyboard controls, and readable static state.

## Combine Concepts

Read [composition-recipes.md](references/composition-recipes.md) when combining examples. Give each region a clear responsibility and explicitly choose which clock owns the experience. A combination should make a product action or narrative point clearer; adding more simultaneous animations is not the objective.

For an application, let state changes trigger Choreo. For a recording, reconstruct the state and the owned runs from the requested time. For a guided tour, choose whether narration or a composition clock advances the chapter and define recovery for missing clips. Keep visual timing and audio completion from independently advancing the same tour.

## Give the Design Live Controls

Use DialKit 2's vanilla adapter, not React components inside Glimmer. Read [tuning-and-recording.md](references/tuning-and-recording.md) for the integration boundary and recording checks.

Expose a small set of meaningful parameters with usable extremes: transition shape and duration, spacing, camera framing, or the force that drives a simulation. Keep the shipped defaults unchanged until the user edits them. Let the actual Choreo/Motion implementation produce the preview; a second preview-only spring would teach a different motion system.

For the existing catalog, `/playground/:demo_id` provides the shared tuning workspace. `test-app/app/lib/demo-tuning.ts` binds controls to named variables at each demo’s actual call sites, and `demo-workbench.gts` owns the controls. Every displayed control must feed a specific variable consumed by that demo. Expose units and preserve the code’s defaults. Shared source variables must remain shared; do not replace unrelated transitions with a generic spring.

## Verify the Deliverable

Follow `AGENTS.md`: build before lint/type checking, and use `glimmer-motion/test-support` when testing motion. Check the first interaction, mid-flight interruption, reset, and cleanup after leaving the route. For recordings, seek in a nonsequential order and inspect the encoded artifact at its delivery size.

Keep generated MP4s, credentials, private account identifiers, and private hosted demo URLs out of reusable source. Follow the user's requested publication scope; this skill does not add permission to deploy.
