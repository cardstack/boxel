## What it is

The text equivalent of a node graph: the same nodes and edges the picture draws, rendered as a navigable outline that can select, focus and connect.

It exists so a graph canvas is not a pointer-only, sight-only surface. **NodeCanvas** draws the picture; this is how it is reached any other way.

## The contract

```
@nodes?, @edges? — the same nodes and edges the picture draws
@label?     — name of the graph this describes; used to name the region
@mode?      — 'sr-only' (default) hides until focused; 'visible' is always a caption strip
@activeId?  — the node currently selected in the picture, so the outline can mark it
@onSelect?  — activating a node row calls this — select and focus it in the picture
@onConnect? — called when the reader completes a connection in connect mode. Its
              PRESENCE is what turns connect mode on
@onRelayout? — re-run the auto-layout; drawn only when supplied
@outlineId? — id for the region, so a canvas can point aria-describedby at it
```

**The handlers gate the affordances.** No `@onConnect`, no arming control and no connect mode — the outline is read-only. No `@onRelayout`, no relayout button. An affordance that does nothing is worse than none.

**`@mode='sr-only'` hides the outline until focused**, which is the default: a graph that already has a picture does not need a permanent text duplicate on screen, but it does need one a keyboard user can reach.

**`@outlineId` is how the canvas points at it.** The picture carries `aria-describedby` to this region, so the two are one thing to assistive technology rather than a graphic and an unrelated list.

## Prior art

None worth naming — node-graph libraries do not ship a text equivalent, which is why a graph editor is typically unusable without a mouse.

So the comparison is against the absence: a canvas with `role='img'` and a label, if that. Where Pretui is better is that connecting two nodes — the primary editing gesture in a graph — has a keyboard path at all.

Where it is thinner: no edge editing beyond creation, no grouping or subgraph navigation, and no spatial information — the outline knows topology, not layout, so "the node to the left" is not expressible.

## Accessibility

- **This component *is* the accessibility story for the graph.** Everything it does exists because a canvas cannot do it.
- **It is a named region**, pointed at by the picture's `aria-describedby`, so a reader encountering the graphic is told where its description lives.
- **Selection is two-way.** `@activeId` marks what the picture has selected; `@onSelect` moves the picture from the outline. Without both, the two views drift apart and a keyboard user is working blind against a picture showing something else.
- **Connect mode is an arming control plus two activations** rather than a drag, which is the only way a connection gesture can exist without a pointer.
- **`@mode='visible'` is worth considering for a complex graph** — a caption strip helps everyone, not only screen-reader users, and a hidden-until-focused outline is still hidden from someone who would benefit from reading it.
- **The outline does not convey layout**, and should not pretend to: a reader is told what connects to what, which is the graph's meaning.

## Theming

The outline takes the kit's shared surface and control tokens; in `sr-only` mode it is visually hidden until focused, at which point it renders as a normal focusable region.

There is deliberately no bespoke styling: when this becomes visible it should look like the rest of the application, because at that moment it *is* the interface.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
