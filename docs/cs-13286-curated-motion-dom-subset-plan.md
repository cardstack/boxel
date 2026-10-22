# Curated motion-dom subset from glimmer-motion — plan

## Goal

Realm cards reach Motion's engine only through `glimmer-motion`; `motion-dom` is not shimmed into realms.
glimmer-motion's public index therefore re-exports the small imperative subset the gallery demos use, with
types, and the README documents it.

## The subset

| export                       | source              |
| ---------------------------- | ------------------- |
| `motionValue`, `MotionValue` | `motion-dom`        |
| `transformValue`             | `motion-dom`        |
| `styleEffect`                | `motion-dom`        |
| `frame`                      | `motion-dom`        |
| `animate`                    | `framer-motion/dom` |

## Decisions

- **`animate` comes from `framer-motion/dom`.** motion-dom has no general `animate` (only lower-level
  `animateValue` / `animateMotionValue` / `animateElement`). `framer-motion` is already a regular dependency of
  glimmer-motion, and `framer-motion/dom` is its React-free entry, already used for `scroll` / `inView`. The
  `motion` package's `animate` is this same function, so the demos' call shapes (a motion value with a target,
  and an element with a keyframes object) keep working with no wrapper and no new dependency.
- **`MotionValue` is exported as a type only.** Cards create values with `motionValue()`; exporting the class
  would add its constructor to the public API.
- **One engine instance.** The re-exports are the engine's own bindings, not copies. pnpm overrides keep
  `framer-motion`'s `motion-dom` the same copy as glimmer-motion's, so `animate`, `frame` and `{{motion}}`
  share one frame loop.
- **Internals stay unexported** (`animateVisualElement`, `visualElementStore`). Adding a name is a
  glimmer-motion API change.

## Files

- `packages/glimmer-motion/src/index.ts`: the re-exports.
- `packages/glimmer-motion/README.md`: API table row, an "engine's imperative surface" section, and the
  React → Glimmer row pointing at glimmer-motion instead of motion-dom.
- `packages/choreo-test-app/tests/unit/engine-exports-test.ts`: a unit test.

## Testing

- The unit test asserts identity with `motion-dom`'s and `motion`'s functions, and exercises `animate`,
  `transformValue` and `styleEffect` on the frame loop.
- `pnpm lint` in glimmer-motion and choreo-test-app; the glimmer-motion build emits the declarations.
- The demos keep their own imports; they move to glimmer-motion when the gallery is ported to realm cards.
