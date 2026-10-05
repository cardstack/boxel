# sigpad/ — signature_pad, vendored

`index.js` is [signature_pad](https://github.com/szimek/signature_pad) bundled
to a single self-contained ES module. **15 KB min / 4.7 KB gzip.** The package
has **zero runtime dependencies**, so nothing is inlined and no bare specifier
survives — the realm loader resolves the whole thing from this one file.

## Provenance

| | |
|---|---|
| **Source** | **local checkout**, not npm — the working copy of `szimek/signature_pad` |
| **Commit** | `fe82b5145eda7d6e48bf8d40f6a47e5d554a13ff` (`fe82b51`) |
| **Version** | `git describe` → **`v5.1.4-4-gfe82b51`** — i.e. 5.1.4 plus 4 commits |
| **Tree state** | clean |
| **SPDX** | **MIT** — verified from the checkout's own `LICENSE`, copied here verbatim |

The checkout is preferred over npm as a standing rule: these working copies are
deliberately kept and are frequently *ahead* of the published release, so an
npm bundle can silently carry a bug the source has already fixed.

**The tradeoff, stated:** a bundle built from an untagged commit no longer
corresponds to any published release, so *the SHA is the only thing that makes
it reproducible*. `signature_pad@5.1.4` does not identify these bytes;
`fe82b51` does.

**What the 4 extra commits contain, checked:** all four are Dependabot bumps of
*development* dependencies — `js-yaml`, `undici`, `fast-uri`, `ip-address`.
`diff -r` over `src/` against the published `signature_pad@5.1.4` tarball is
**empty**, and the built bundle body is **byte-identical** to the npm-built one
(banner aside). So on this occasion the checkout and the release agree; the
provenance is recorded because *that had to be checked to be known*, and the
next rebuild may not be so lucky.

**No build step was skipped.** The package ships TypeScript source and esbuild
compiles TS directly, so bundling from `src/` in the checkout is the same
operation as bundling from `src/` in the tarball — no `yarn build`, no
pre-compiled `dist/` involvement, nothing done on our behalf by npm.

## Exports

    default   SignaturePad   the engine (variable-width Bézier over pointer events)
    Point                    x / y / pressure / time, distanceTo, velocityFrom, equals
    Bezier                   fromPoints, length, point — the curve maths

`Point` and `Bezier` are **not** exported from the upstream package root; the
lean entry pulls them from `src/` so the pure maths is unit-testable without
touching a canvas. That is the only deviation from a plain re-export.

Built with:

    esbuild lean-sigpad.ts --bundle --format=esm --minify --line-limit=500 \
      --legal-comments=none --banner:js="<licence banner>" --outfile=index.js

where `lean-sigpad.ts` is, with `<checkout>` the local working copy at
`fe82b51`:

    export { default } from '<checkout>/src/signature_pad.ts';
    export { Point }   from '<checkout>/src/point.ts';
    export { Bezier }  from '<checkout>/src/bezier.ts';

`--legal-comments=none` strips the licence notice out of the bundle, so the MIT
notice clause is satisfied by the `LICENSE` file beside this one plus the
one-line banner at the top of `index.js`.

## Five things to know before using it

- **Import is DOM-free; the constructor is not.** Evaluating this module
  touches no DOM API (verified under plain Node: `typeof document` is still
  `undefined` after import), so it is safe anywhere in the realm graph.
  `new SignaturePad(canvas)` attaches pointer listeners immediately and must
  only ever run inside an `ember-modifier` — never in a getter the indexer
  might evaluate.

- **Pass `throttle: 0`.** This is the realm-law-critical setting. The default
  (`16`) routes every pointermove through `src/throttle.ts`, whose trailing
  edge is a `window.setTimeout` the library owns and we cannot reach. At
  `throttle: 0` the constructor wires `_strokeMoveUpdate` straight to
  `_strokeUpdate` and the bundle schedules **no timer of any kind** — better
  than owning the handle, because there is no handle. Browsers already
  coalesce pointermove, so nothing is lost. Audit of the bundle:
  **1 `setTimeout`** (throttle only, dead at `throttle: 0`), **0 `setInterval`,
  0 `requestAnimationFrame`.**

- **Wall-clock reads exist and are confined to the live pointer path.**
  `Point`'s constructor falls back to `Date.now()` and `_createPoint` calls
  `new Date().getTime()`. Neither runs at module scope or during indexing —
  only while a human is drawing. `fromData()` passes the stored `time` through,
  so redraw and round-trip are deterministic.

- **`time: 0` is a landmine.** `point.ts` reads `this.time = time || Date.now()`,
  so a point whose stored time is exactly `0` silently gets stamped with the
  wall clock, and `velocityFrom` then returns a nonsense negative velocity.
  Any fixture, test vector or serialized stroke must use **non-zero** times.

- **Resizing a canvas clears it.** Writing `canvas.width`/`canvas.height`
  (which HiDPI scaling requires) wipes the backing store. Always
  `toData()` → resize → `fromData()`. The engine has no opinion about this;
  the consumer must do it.

Consumer: `signature-pad.gts` — the `sigPadInto` modifier is the reusable
Glimmer binding (ResizeObserver-driven HiDPI sizing, redraw-preserving resize,
teardown via `off()` + `disconnect()`).
