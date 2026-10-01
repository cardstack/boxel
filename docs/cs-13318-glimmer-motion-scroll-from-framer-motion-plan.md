# glimmer-motion's scroll layer from framer-motion/dom

## Goal

glimmer-motion takes `scroll()`, `scrollInfo()` and `inView()` from Motion's published, React-free `framer-motion/dom` entry point instead of carrying copies of Motion's `render/dom/scroll/**` and `render/dom/viewport` source. A Motion version bump then updates this layer with no hand re-diff.

## Assumptions

- `framer-motion@13.1.1` is the release the copied files came from, so behaviour is unchanged.
- `framer-motion` lists `react` / `react-dom` as optional peers, and its `dom` entry imports neither.
- The workspace catalog already pins `framer-motion`, `motion-dom` and `motion-utils`, and the root `overrides` force every install onto those versions. framer-motion therefore resolves the same `motion-dom` instance as glimmer-motion and Choreo.

## Steps

1. Add `framer-motion: "catalog:"` to glimmer-motion's `dependencies`. The lockfile gains only that importer entry.
2. `src/scroll.ts` imports `scroll`, `scrollInfo`, `inView` from `framer-motion/dom` and re-exports them. framer-motion doesn't export the option and callback types by name, so `scroll.ts` reads them off the function signatures (`ScrollOptions`, `ScrollOffset`, `ScrollInfo`, `InViewOptions`, and the internal `ScrollInfoOptions`).
3. `src/index.ts` exports the functions and types from `./scroll.ts`, so the public names are unchanged.
4. Delete `src/dom/**` and its entry in the eslint "verbatim copies" override.
5. Point the API inventory (`choreo-gallery/docs/api-inventory.json`, `core-api-inventory.md`) and the `core-scroll` guide at `src/scroll.ts`.

## Target files

- `packages/glimmer-motion/{package.json,eslint.config.mjs,src/index.ts,src/scroll.ts}`
- `packages/glimmer-motion/src/dom/**` (deleted)
- `packages/choreo-gallery/docs/api-inventory.json`
- `packages/choreo-test-app/app/content/guides/{core-api-inventory,core-scroll}.md`
- `pnpm-lock.yaml`

## Testing

- The `whileInView`, `useInView`, `useScroll` and `raise and scroll` modules in `choreo-test-app` are the gate. The full suite runs in CI.
- `pnpm lint` in glimmer-motion (includes `ember-tsc`) and `pnpm docs:check` in choreo-gallery.
- No `react` import in glimmer-motion's `dist/`, the test-app build, or the realm bundle (`scripts/build-realm-bundle.mjs --no-mirror`).
- The lockfile has a single `motion-dom`.
