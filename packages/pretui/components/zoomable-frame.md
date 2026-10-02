## What it is

A zoom-and-pan viewport around framed content: a scale control, a pannable surface, and a readout of where you are.

## The contract

```
@label?    — accessible name for the viewport. Required in practice
@min?      — smallest scale. Default 0.25
@max?      — largest scale. Default 4
@step?     — multiplier per zoom step from a button or key. Default 1.25
@scale?, @onScaleChange? — controlled scale
@hideToolbar? — hide the toolbar; the keyboard and pointer paths are unaffected,
             but THE READOUT GOES WITH IT

<:default> — the framed content, laid out at its natural size and transformed
             as a whole, so nothing inside needs to know it is being zoomed
```

**`@step` is a multiplier, not an increment.** Zoom is perceptually multiplicative — 1× to 1.25× and 2× to 2.5× feel like the same step — and an additive zoom control feels wrong at one end or the other.

**The content is transformed as a whole**, so nothing inside needs to know it is being zoomed. A component in a zoomable frame renders at its natural size and is scaled; it does not receive a scale factor to honour.

**`@hideToolbar` takes the readout with it**, and the contract says so: only hide it when the scale is displayed somewhere else. A zoom with no visible scale is a viewport a reader can get lost in.

**`@label` is required in practice** — it is the only thing a screen reader can say about a pannable box.

## Prior art

The zoom viewport in design and diagram tools.

Where Pretui is better: the multiplicative step, and the honesty about what `@hideToolbar` costs. Both are small; both are things that get decided badly by default elsewhere.

Where it is thinner: no fit-to-content or zoom-to-selection, no minimap, no rotation, and no pinch gesture contract beyond what the browser gives.

## Accessibility

- **The viewport is named**, which is the whole of what assistive technology can be told about it.
- **Zoom has a keyboard path** through the step controls, independent of the toolbar's visibility.
- **The readout is the orientation affordance.** Panning a zoomed surface with no indication of scale is disorienting for everyone and worse for anyone using magnification on top of it.
- **Panning is a pointer gesture**; scrolling the viewport is the keyboard equivalent, and the content inside keeps its own tab order.
- **Zooming does not change what is announced.** The accessibility tree is the content's, unscaled — which is correct, and means a reader is unaffected by a scale someone else chose.

## Theming

The frame and toolbar take the kit's surface and control tokens; the content is untouched by them.

Deliberately so: a zoomable frame is a lens, and a lens that tinted what it showed would make the content inside impossible to judge.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
