# Live Scene Crossings

A live crossing connects two rendered scenes while their controls, video, or canvas remain real content. The `c.Crossing` composite expresses the common pattern of departing-only content fading, paired subjects moving, and arriving-only content appearing near the landing. It is built from the same public steps that an application can compose itself.

## Declaring the Crossing

Place the changing subtree inside a persistent `Choreo` with `@route=true`. This mode treats the swap as one crossing pass and applies the requested window scroll before measuring the incoming bounds. Give corresponding subjects matching motion identities in both scenes.

```gts title="Component template excerpt"
<Choreo @route={{true}} @scroll='top' as |c|>
  {{outlet}}
  <c.Crossing @name='page' @spring={{flight}}
    @leave={{0.18}} @arrive={{0.22}} @overlap={{0.7}} />
</Choreo>
```

The example's `flight` is a module-scope spring configuration. `@leave` and `@arrive` are fade durations in seconds. `@overlap` places arrivals relative to the flight, so the composition can feel like one continuous change rather than three unrelated pauses.

## Preserving Shape

The composite defaults to crop sizing: the receiver is scaled uniformly and the changing window handles aspect differences without resizing the surrounding row on every frame. `@size` can override that choice. `@swap` selects how counterpart skins cross during the journey. Evaluate text and borders at intermediate frames before selecting a policy just because the start and end look correct.

A named crossing exposes an inner flight name such as `page:flight`, allowing a companion step to anchor against the actual move. Specific sibling steps can override generic work in the composite, so the default vocabulary does not prevent a particular role from receiving special treatment.

## Coordinating Expensive Content

A large destination may mount new effects while the crossing is active. `@quiet` pauses animations already running elsewhere in the document for the span of the run, but it does not automatically catch every animation created afterward. The host can use `createArming()` to coordinate entrance effects or an expensive activation with the crossing's lifecycle.

## Testing Repeated Navigation

Click again during the flight, navigate back, and open content that changes height. The receiving subject should stay continuous, the old scene should release its orphaned skin, and the new controls should accept input. Scroll restoration and focus behavior belong in the verification too.

Use browser view transitions only when a captured representation is acceptable. The point of this crossing is that a moving demo can keep running; replacing it with a screenshot transition changes that behavior even if the camera-like movement looks similar.

## API Coverage

**ChoreoContext**: `c.Crossing`.

Read the implementation: [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
