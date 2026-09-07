# Agent guide — Choreo / glimmer-motion

One package, two layers. **`glimmer-motion`** binds the Motion (motion.dev)
engine — `motion-dom`, untouched — to Glimmer: the `{{motion}}` modifier,
`<Presence>`, `<LayoutGroup>`, `<MotionConfig>`, reorder, drag, gestures,
scroll, view transitions. **Choreo** sits on top: `<Choreo>` watches a render
pass, hands its **changeset** (inserted/removed/kept, bounds before and
after) to a timeline you declare in the template. The repo is `choreo`; the
npm package is still `glimmer-motion` — every import in docs and code is the
real one.

## Layout

- `packages/glimmer-motion/` — the addon. `src/index.ts` is the public
  surface; `src/choreo/` is Choreo's model; ~40 lines of Ember-specific glue,
  the rest is host-agnostic.
- `test-app/` — the gallery (every demo in
  `app/components/examples/*.gts` is real, catalogued in `app/lib/catalog.ts`)
  and the test suite: ported upstream Motion tests (fidelity) + Choreo's
  contract suite.
- `docs/guide.md` (tutorial), `README.md` (reference),
  `docs/choreography.md` + `docs/nested-choreo.md` (Choreo design).

## Building from the Gallery

For recreating demos, combining patterns into applications or films, or adding
live DialKit controls, use `.claude/skills/choreo-create/SKILL.md`. Codex also
discovers the same skill through `.agents/skills/choreo-create`. The documentation
website at `/docs` teaches core glimmer-motion, interactive Choreo, spatial/3D
Choreo, and recorded/film Choreo as four learning paths.

## Picking an animation pattern

Before writing any animation, invoke the **`motion-pattern`** skill — it
routes to the right pattern skill. Short form:

| Need                                                          | Use                                                            | Skill                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| One element animates                                          | `{{motion}}` initial/animate/gestures                          | `motion-element`                                   |
| Animate on removal/insert                                     | `<Presence>` + `exit`                                          | `motion-presence`                                  |
| Moved because layout changed; same thing in two places        | `layout` / `layoutId` / `<LayoutGroup>`                        | `motion-layout`                                    |
| Ordered multi-element scenes, z-index windows, fly-to-a-place | `<Choreo>` timeline + `{{beacon}}`                             | `choreo-scene`                                     |
| Multiple regions; cross-region flights                        | nested `<Choreo>` + far matching                               | `choreo-regions`                                   |
| Route/page change                                             | `<Choreo @route>` for live DOM; snapshot APIs when intentional | `magic-move-navigation` / `motion-page-transition` |
| The gallery ⇄ demo Magic Move recipe                          | `<Choreo @route>` pairing                                      | `magic-move-navigation`                            |
| Pointer-driven movement                                       | `drag` / `<ReorderGroup>`                                      | `motion-drag`                                      |
| Scroll-driven / in-view                                       | `scrollProgress` / `InView`                                    | `motion-scroll`                                    |
| Tests touching motion                                         | `glimmer-motion/test-support`                                  | `motion-testing`                                   |

Escalate element → presence → layout → Choreo; use the smallest pattern that
states the intent. Two standing vetoes: no view transitions over live
content (snapshots freeze it — use layout animation), and no `setTimeout`
sequencing (that is what `c.Sequence` is for).

## Three rules that silently break motion in Glimmer

1. CSS for a motion element goes through the modifier
   (`{{motion style=…}}`), never a bound `style=` attribute — Glimmer
   rewrites the attribute and wipes the engine's transform.
2. Anything the engine must tween/correct/measure must be declared to it —
   a stylesheet `border-radius` on a `layout=true` element distorts;
   `style=(styles borderRadius='14px')` doesn't.
3. Exit content rides on what `<Presence>` yields; a leaving block re-runs
   from live state, so don't read moved-on state during an exit.

## Commands

```bash
pnpm install
pnpm build          # builds the addon (required before lint — glint resolves built declarations)
pnpm lint           # eslint + glint + prettier
pnpm test           # builds, then runs the suite in Chrome
```

Dev server for the gallery: `.claude/launch.json` → `glimmer-motion-tests`
(vite on 4202; `/tests` for the QUnit runner). CI runs `pnpm build` before
`pnpm lint` — keep that order.

## Conventions

- `.gts` templates; named exports, no `Component` suffix; Glint signatures
  on every public component/modifier.
- Transition constants at module scope, not inline hashes; helpers
  (`to`, `spring`, `tween`, `styles`, …) over `(hash …)`.
- `data-test-*` for test hooks; never sleep in tests
  (`animationsSettled()`).
- `prefers-reduced-motion` is honoured by default (`@reducedMotion="user"`).
  Don't opt out to make a demo look right.
- Dark theme is the reference look; light mode rebinds tokens
  (`:root[data-theme='light']`) and must not change dark's resolved values.
