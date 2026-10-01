## What it is

A magnifying dock: a row of items that grow as the pointer approaches, like the macOS dock.

## The contract

```
@size?  — base item size in px. Default 40
@label? — accessible toolbar label. Default 'Dock'

<:default> — yields { Item }, the magnifying slots
```

Two args. The item is yielded rather than imported, so it cannot be used outside a dock, where the magnification would have nothing to respond to.

**The magnification is pointer proximity**, which means it does not exist for a keyboard user or on a touchscreen — the dock is a toolbar that happens to have an effect, and the effect is not load-bearing.

## Prior art

The macOS dock, and the same effect in web component kits.

Where Pretui is better: it is a real toolbar with a real role underneath the effect, rather than a row of divs that magnify.

Where it is thinner: no drag-to-reorder, no running indicators, no separators, and no overflow — a dock wider than its container clips.

**A known gap:** it uses `role='toolbar'` without the toolbar keyboard contract — arrow-key navigation between items. That is a real defect rather than a simplification: a toolbar role promises arrow navigation, and a reader who tries it gets nothing.

## Accessibility

- **`role='toolbar'` with a label**, defaulting to 'Dock'.
- **The missing arrow-key contract is the thing to know.** The role announces a keyboard model the component does not implement, which is worse than not claiming the role at all.
- **The magnification conveys nothing.** It is decoration, and its absence for keyboard and touch users costs them no information.
- **Each item needs its own name**, since a dock is usually glyphs.
- **Reduced motion should hold the items at base size**, which is the resting state.

## Theming

`--pretui-dock-size` (from `@size`) and `--pretui-dock-scale` (the magnification factor), over the shared `--pretui-dur-snap` and `--pretui-ease-snap`.

Keeping the scale as a token lets a season dial the effect down — or to 1, which turns the dock into a plain toolbar without the caller changing anything.
