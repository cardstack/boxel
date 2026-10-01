## What it is

A capsule that changes size with what it has to say: a resting sliver, a one-line state, and an expanded detail view.

## The contract

```
@view?, @defaultView?, @onViewChange? — controlled / uncontrolled view.
              Default 'compact'
@label?       — accessible name for the capsule
@expandable?  — let the reader toggle compact ⇄ expanded. Default true.
                Turn it off for a purely host-driven status capsule

<:idle>    the resting sliver — a dot, a bar, a single glyph
<:compact> the one-line state: what is happening, right now
<:expanded> the detail: controls, progress, a description
```

**Three blocks, three sizes, one element.** The capsule morphs between them rather than swapping components, which is what makes the transition read as one object changing rather than as three things replacing each other.

**`@expandable={{false}}` makes it host-driven only.** A status capsule that the reader cannot open is a legitimate thing — the arg exists so that is expressible rather than being achieved by omitting a handler.

## Prior art

Apple's Dynamic Island.

Where Pretui is better: it is a contract with three blocks rather than an effect. The upstream is a platform affordance; this is the same idea made composable, with the view as controllable state so a host can drive it from what is actually happening.

Where it is thinner: no multi-activity stacking — one capsule, one state — no gesture model beyond the toggle, and no priority or queueing when two things want the island at once.

## Accessibility

- **The capsule is named**, which is essential for something that changes shape: without a stable name, a screen-reader user encounters what appears to be a different element each time.
- **`@expandable` decides whether there is a control at all.** When false, the capsule is a live status region and nothing more; when true, it is a disclosure.
- **A capsule that changes content without announcing it is a silent status.** Whether the view change is announced is the host's decision through what it puts in the blocks — the component supplies no live region of its own.
- **The idle sliver is often a single glyph**, which needs to be `aria-hidden` with the meaning carried elsewhere, or it announces as an unnamed graphic.
- **Motion is central to this component's identity**, so reduced motion should land it on the target size without the morph.

## Theming

The capsule takes the kit's elevation and surface tokens, with the morph riding the shared duration and easing.

Using the shared motion tokens is what keeps the island feeling like the same product as every other transition — an island with its own curve is the one element that moves differently from everything around it.
