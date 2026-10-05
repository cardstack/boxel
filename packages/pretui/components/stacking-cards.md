## What it is

Cards that stack as you scroll: each one pins at a ledge below the previous, so the set builds into a deck rather than scrolling away.

## The contract

```
@offset? — px each card's pin ledge sits below the previous card's. Default 12

<:default> — yields { Card }; render each stacked card as a direct child
```

One arg, and a yielded component. The card is yielded rather than being a separate import so a caller cannot use it outside a stack, where the pinning would have nothing to pin against.

**`@offset` is the ledge depth**, and it accumulates: the fifth card in a stack sits four offsets below the first. That is what makes the deck legible as a count.

**The pinning is CSS sticky**, not a scroll listener — there is no measurement and no frame loop.

## Prior art

The stacking-cards scroll effect in marketing sites.

Where Pretui is better: it is `position: sticky` and an offset rather than a scroll-driven transform, which means it costs nothing, cannot desync, and works with the browser's own scrolling rather than against it.

Where it is thinner: no horizontal stacking, no scale or rotation as cards recede, and no control over which card is "active" — the browser decides, by scroll position.

## Accessibility

- **The cards are in source order and stay there.** Stacking is a visual arrangement produced by sticky positioning; nothing is reordered, hidden or removed, so a screen reader encounters the full set in sequence regardless of scroll position.
- **That is the property that makes this effect safe**, and it is worth stating because most scroll-driven card effects achieve the look by transforming or removing elements.
- **Reduced motion does not need a special case**, because there is no animation — the cards move with the scroll, not on a timeline.
- **A deep stack accumulates offset**, so with a large `@offset` and many cards the last card's usable height shrinks. That is a layout consequence, and it hits anyone using a small viewport or large text hardest.

## Theming

`--pretui-stack-offset` (from `@offset`), `--pretui-stack-gap`, `--pretui-stack-index` and `--pretui-stack-top` — the per-card index and its computed pin position.

The cards themselves take whatever surface the caller gives them; the component supplies position and nothing else, which is what lets a stack be built from any card in the kit.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
