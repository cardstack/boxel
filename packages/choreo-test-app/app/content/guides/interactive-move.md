# Measured Movement, Size, and Paths

`c.Move` uses the bounds before and after a render pass to connect two real layouts. The application renders the destination; the timeline explains how the subject travels there. This keeps layout decisions in CSS and state while giving the movement explicit timing, paths, and counterpart policies.

## Choosing What Moves

Select kept or received participants with `@of`. Use a spring for an interruption-friendly response, or duration and easing for an authored timed flight. `@from` and `@to` can borrow a beacon's box when the journey begins or ends at a place that is not the participant's own layout position.

```gts title="Component template excerpt"
<c.Move @of={{c.moved 'card'}} @duration={{0.6}}
  @size='crop' @path='M 0 0 C 40 -80, 160 -80, 200 0' />
```

The path bends the journey between the measured endpoints. Its SVG path coordinates are mapped onto the actual displacement, so the authored curve does not become an unrelated absolute screen destination. `@rotate='auto'` can orient the subject along the tangent; a numeric rotation supplies a fixed additional angle.

## Choosing a Size Policy

A movement between different rectangles also needs a size policy. Transform scaling, real width-and-height changes, and cropping have different consequences for text and surrounding layout. The crossing composite defaults to crop so a receiver does not reflow its entire grid row during the flight. Inspect the direct Move contract before choosing a different policy for a specific layout.

`@swap` controls the relationship between counterpart skins: during the flight, at settlement, or no automatic swap. This is about two real representations of one identity. It is not permission to treat unrelated components as the same subject, and it cannot turn live text into a continuously morphing glyph outline.

## Choosing a Coordinate Space

`@space='page'` is the usual choice for movement that must remain correct as its region moves. Parent space is appropriate when the intended displacement belongs to a moving local frame. A nested or externally scaled stage should be tested under the actual transforms; an unscaled fixture cannot validate cross-plane geometry.

Watch the first frame, interruption, and landing. The first frame should reproduce the outgoing pose even though layout has already changed. An interrupted run should continue from the visible state, and the final transform should be released into the destination layout. Text distortion, an early flash, and a final snap are separate clues about size policy, ownership, and measurement ordering.

## API Coverage

**ChoreoContext**: `c.Move`.

Read the implementation: [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
