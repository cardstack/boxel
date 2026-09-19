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
