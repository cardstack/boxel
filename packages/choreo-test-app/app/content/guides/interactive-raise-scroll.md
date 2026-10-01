# Elevation and Directed Scrolling

A timeline can move the correct object toward the correct place and still fail visually because an ancestor clips the flight or the destination is outside the visible scroll area. `c.Raise` and `c.Scroll` address those two presentation problems without changing the logical identity of the subject.

## Elevating a Live Participant

`c.Raise` promotes selected participants to the region's elevated layer for a defined window. It preserves the real element, which matters for a card containing controls. It is more than setting z-index: a high z-index inside a clipped stacking context cannot escape that context by itself.

```gts title="Component template excerpt"
<c.Parallel>
  <c.Move @of={{c.moved 'card'}} />
  <c.Raise @of={{c.moved 'card'}} @shadow={{true}} />
</c.Parallel>
```

The raise can use its own duration or share its block's span. `@shadow` adds the elevation treatment supplied by the runtime. The element must preserve measured continuity when entering and leaving the elevated layer; changing its DOM parent must not make it jump or lose the coordinate relationship to its flight.

## Bringing a Target Into View

`c.Scroll` moves the selected sprite's scroll container toward an alignment such as start, center, or end. It occupies time in the sequence, so another step can wait for the reveal or overlap it through an anchor. This is useful for a triage list or a guided explanation that needs to expose a specific item.

The target is a participant query, not a hard-coded scrollTop value. That lets the step use the captured geometry and the actual container. Test with the content sizes the product uses, especially when items expand or headers occupy part of the available viewport.

## Keeping User Control

Directed scrolling should help the user locate the subject without fighting their own input. If a person starts scrolling during the movement, inspect the runtime's interruption behavior and ensure the interface remains usable. Do not repeatedly reset scroll position from unrelated renders after the step has finished.

## Testing the Boundaries

Use fixtures with overflow clipping and an external scale, then inspect intermediate frames. A final-state assertion can miss an element that disappeared behind its parent for most of the journey. After settlement, verify that elevated elements returned to the intended live tree and that no orphan intercepts input. For scroll, assert the subject's position relative to the container rather than assuming the window is the scroller.

Keep these operations separate from a 3D camera. Raising a DOM participant changes its compositing layer within a region; it does not create a physical world-space object or solve arbitrary WebGL occlusion.

## API Coverage

**ChoreoContext**: `c.Raise`, `c.Scroll`.

Read the implementation: [`choreo.gts`](https://github.com/cardstack/choreo/blob/main/packages/glimmer-motion/src/choreo.gts).
