# Composing a Continuous Loop

A loop can communicate a relationship instead of simply decorating a page. In this study, the same circles gather into a compact cluster, spread into a translucent field, settle into a grid, and return home. The arrangement changes, but the cast stays mounted. Your goal is to understand which movement belongs to the whole composition and which belongs to an individual circle.

The example is inspired by a supplied iOS animation. It reconstructs its visual vocabulary with live DOM elements; it does not reproduce the original implementation or claim to use Core Animation.

## Separate the two coordinate levels

The parent plane owns the shared zoom. Each circle owns its local translation, scale, and opacity. Increasing **Zoom** magnifies the composition without changing the grid's local spacing. Increasing **Grid spacing** changes the distance between neighbours before the parent transform is applied. Try these separately: similar-looking screen movement can come from different coordinate levels.

Circles have fixed dimensions and circular borders. Their size changes through scale, so the browser does not need a new layout for each animation frame. The scattered positions are calculated deterministically when the score is built, rather than randomly during playback. Replaying therefore produces the same arrangement.

## Place keyframes in time

`c.Tween` accepts `@times`, an array of normalized offsets. Zero is the beginning of one cycle and one is its end. Each offset corresponds to a value in every keyframe array on that step. Without `@times`, the engine spaces the keyframes evenly.

Inside a scene that already participates in a render pass, the timing declaration is:

```hbs
<c.Tween
  @of={{c.id 'dot'}}
  @x={{array 0 0 100 0 0}}
  @times={{array 0 0.15 0.5 0.85 1}}
  @duration={{8}}
  @repeat={{this.forever}}
/>
```

`this.forever` is `Infinity`. Register the dot with `{{motion id="dot"}}`.
Choreo's first render establishes the scene; the example starts its score with
one cancellable animation-frame callback that triggers a second render. That
callback only starts the score. It does not sequence or update animation frames.

Here the dot holds its position for the first 15 percent of the cycle, travels, returns, and holds again. Repeated values create holds; repeated offsets are invalid. Supply at least two finite, strictly increasing offsets, beginning at zero and ending at one. Every array target must have the same length as `@times`. Scalar targets remain valid alongside those arrays.

## Repeat the complete score

Each circle track contains the complete cycle and uses the same duration and offsets. `c.Parallel` starts those tracks together. An infinite tween is ambient: it continues beyond the run's scheduled end. Repeating a tween does not repeat an enclosing sequence, so do not independently loop the cluster, grid, and return steps.

Matching the first and last values prevents a position jump. This example also holds at both ends, creating a quiet boundary with zero movement. A continuously moving loop would need matching endpoint velocity as well. Faster playback alone cannot repair a discontinuity.

## Tune with intent

**Cycle duration** changes pace in seconds. **Scatter radius** sets the field's extent in pixels. **Field opacity** controls the background circles, while **Zoom** and **Grid spacing** reveal the coordinate relationship described above. Soft Orbit gives the composition breathing room; Punchy Mosaic makes the changes more emphatic. Editing a score may restart its cycle; it does not promise to preserve the current phase.

The same study appears in the 3D gallery and its full narrated tour. The short highlight remains a separate editorial selection. It isolates a reusable idea for loading sequences, data rearrangements, and transitions between overview and detail. Preserve reduced-motion preferences, and measure performance on the target device before assuming that every transform is compositor accelerated.
