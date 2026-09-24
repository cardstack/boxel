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

The pnpm patch `patches/glimmer-motion@0.0.0.patch` corrects raised-element
promotion: use the measured destination box before applying motion, and suspend
parent-relative min/max size constraints while in the overlay. Before a new
measurement, return raised elements to their real parents so interruptions and
reduced-motion changes resolve the current destination correctly. Visibility
holds are applied synchronously, before the first painted frame. It also exposes
the raised layer's z-index through `--choreo-raised-z-index`. Original source-map
links for the two patched runtime files are removed so debugging uses the actual
patched code. Host frame-sampling tests cover the header use case; this correction
should move upstream before the next snapshot refresh.

The patch also evaluates sampled paths at their exact final point. The upstream
epsilon clamp left a tiny nonzero transform behind after reduced-motion jumps.

`patches/motion-dom@13.3.0.patch` batches the view-transition participant style
reads across all subjects before assigning any names, classes or groups. The
upstream batch covered only one `.add()` call, so separately matched headers,
icons and shadows repeatedly invalidated styles before the next subject's read.
Both ESM and CommonJS entries receive the correction. Paired names, author names,
group clipping and cleanup retain their existing behavior. Source-map links for
modified entry files are removed. The host bitmap tests include a regression for
interleaved source reads; move this correction upstream when refreshing Choreo.
