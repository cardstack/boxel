# Choreo host dependency

`glimmer-motion-0.0.0.tgz` is a built snapshot of the Choreo addon from
https://github.com/cardstack/choreo. Choreo has no published npm release yet;
keeping the archive here makes installs independent of a developer's checkout.

This snapshot was packed on 2026-09-19 from the local Choreo checkout based on
`62a2ca8ef18560503957e56274b8a2a7655f1335`, including its current working changes.
The archive includes source maps, declarations, its MIT license, and upstream
vendoring notices. The pnpm lockfile pins its integrity.

To refresh from a prepared Choreo checkout, run the pinned Boxel pnpm toolchain:

```sh
mise exec -- pnpm -C /path/to/choreo/packages/glimmer-motion pack \
  --out /path/to/boxel/vendor/glimmer-motion-0.0.0.tgz
mise exec -- pnpm --filter @cardstack/host add -D \
  glimmer-motion@file:../../vendor/glimmer-motion-0.0.0.tgz
```

Run the host lint, preview build, and `Integration | stack motion` tests after
refreshing. Replace the archive with a versioned registry dependency when Choreo
publishes one.

## Patches

Both patches should move upstream before the next snapshot refresh.

`patches/glimmer-motion@0.0.0.patch`:

- Raised-element promotion uses the measured destination box before motion is
  applied, and suspends parent-relative min/max size constraints while in the
  overlay. Before a new measurement, raised elements return to their real
  parents, so interruptions and reduced-motion changes resolve the current
  destination. Visibility holds apply before the first painted frame. The
  raised layer's z-index is configurable through `--choreo-raised-z-index`.
- Sampled paths are evaluated at their exact final point (the upstream
  epsilon clamp left a tiny transform behind after reduced-motion jumps).
- `<Choreo @armed={{false}}>`: a region with nothing armed and nothing in
  flight skips its before/after measurement, which otherwise forces layout on
  every render of the page.

`patches/motion-dom@13.3.0.patch` (ESM and CommonJS entries):

- Participant style reads are batched across every subject before any
  names, classes or groups are written.
- View-transition CSS is one static rule set installed at load; a transition
  toggles a root class, a root inline name and per-element
  `view-transition-class` tokens. Inserting or removing a stylesheet per
  transition restyled the whole document several times per crossing.
- Browser-generated view-transition animations are replaced with WAAPI copies
  of their keyframes instead of being retimed. Chrome sampled a retimed
  CSSAnimation inconsistently, so layers lurched between two easing curves.

Source-map links for modified entry files are removed so debugging uses the
patched code. The host motion tests (`--filter motion`) cover these paths;
see `docs/host-motion.md` for the architecture they serve.
