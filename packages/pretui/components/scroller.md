## What it is

A scroll container that tells you it is clipped: an edge fade or shadow appearing exactly when there is content past that edge.

It is deliberately small and deliberately first. "Content continues past this edge" is a fact half the kit's collections need, and before this it was re-solved — or skipped — per component. **Carousel** consumes it rather than reimplementing edge detection.

## The contract

```
@orientation?   — which axes may scroll. Default 'horizontal'
@label?         — accessible name; supplying one promotes the viewport to a
                  landmark region
@edge?          — edge treatment: 'fade' (default) | 'shadow' | 'none'
@hideScrollbar? — hide the native scrollbar; the edge affordance stays
```

**The region role is applied only when named.** An unnamed landmark is noise in a rotor, so `@label` is what promotes the viewport rather than the role being unconditional. That is the correct way round and the opposite of what most implementations do.

**Hiding the scrollbar is defensible only because the edge affordance stays.** A scroll container with neither is content that appears to end where it does not — the single most common cause of people not finding the rest of a horizontal list.

**Edge detection is one listener in a modifier** that removes itself in its destructor.

## Prior art

The scroll-shadow and fade patterns every design system reimplements per component.

Where Pretui is better: it is a primitive rather than a treatment applied ad hoc, so every collection that scrolls gets the same affordance with the same behaviour — and the consumers do not each carry a resize observer.

Where it is thinner: no scroll-to-item API, no snap behaviour (that is Carousel), and no programmatic edge query for a caller that wants to react to clipping itself.

## Accessibility

- **A named scroller is a landmark; an unnamed one is a plain box.** Both are correct for their case, and the arg is what distinguishes them.
- **The edge affordance is `aria-hidden`.** It is a visual cue that content continues; a screen reader learns that from the content itself.
- **Hiding the scrollbar removes a pointer affordance and a visual cue.** The edge treatment replaces the cue, not the affordance — keyboard scrolling still works, but a trackpad user loses the drag target.
- **A scroll container needs a tab stop to be scrollable by keyboard.** Whatever is inside usually supplies one; a scroller of non-focusable content is reachable by pointer only, which is worth checking.

## Theming

`@edge` selects between a fade and an inset shadow, both drawn from the kit's surface tokens so the treatment matches whatever it sits on.

That matching is the point: a fade that does not blend into its background reads as a grey band rather than as content continuing, which is why the treatment is token-derived rather than a fixed gradient.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
