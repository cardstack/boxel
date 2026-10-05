## What it is

A **scrim and spinner over a region whose content is still there**. The content does not unmount when loading starts, so nothing reflows when it stops (Law 8). Wrap the region, a form being saved or a table being refreshed, and bind `@open` to the pending state.

Reach for a neighbour when the situation is different:

- **Skeleton** when there is no content yet to cover.
- **Spinner** for an inline busy mark beside a label or inside a button.
- **LoadingState** when the whole scene is loading and there is nothing to keep.
- **Backdrop** for the scrim behind a layered surface such as a dialog.

LoadingOverlay covers one region in place.

## The contract

```
@open? (default false)
@label? (default 'Loading'), @showLabel?
@blur?, @lock?
@size? (the spinner, on the kit scale or in pixels; default 'l')
<:default>   — the region; it stays mounted
Element: HTMLDivElement
```

**The content is always rendered.** The overlay is a sibling layer over it, absolutely positioned inside the region, never a replacement for it. Toggling `@open` does not re-create the content, so focus, scroll position and half-typed input survive a save.

**One announcement, always mounted.** The region carries a `role="status"` element for its whole life. Opening puts `@label` into it, so screen readers hear "Saving billing details" rather than missing a live region that was mounted in the same frame as its text. The spinner inside the scrim is hidden from assistive technology, so the label is announced once.

**`@lock` is the guard against editing half-loaded fields.** While open, it sets `inert` on the content, which takes it out of the tab order and the accessibility tree. Without `@lock`, the scrim blocks the pointer but a keyboard user can still tab into the region. That is right for a background refresh and wrong for a submit.

`@showLabel` paints the label under the spinner. `@blur` frosts the content under the scrim instead of only tinting it.

## Prior art

**Mantine LoadingOverlay** takes `visible`, `loaderProps`, `overlayProps` (blur, colour, opacity) and `zIndex`, and expects the caller to make the parent `position: relative`. **Ant Spin** wraps its children with `spinning` and a `tip`, and blurs the content. **Chakra** has no component; it is Overlay plus Spinner by composition.

Where Pretui is better: **the region is part of the component**, so there is no "remember to make the parent relative". **`aria-busy` is set on the region**, which Mantine does not do and Ant only does on its spinner. **Locking is one switch**: neither Mantine nor Ant stops a keyboard user from tabbing into a covered form. **The announcement survives**, because the status element exists before the text arrives.

Where it is thinner: **no delay.** Ant's `delay` holds the spinner back for fast operations to avoid a flash, and here that is the caller's job. There is **no custom loader slot**, because the spinner is the kit's Spinner. **No progress value**: use **ProgressBar** inside the region for determinate work.

## Accessibility

No APG pattern. What matters is the busy state and one clear announcement.

- **`aria-busy`** is `"true"` on the region while open and `"false"` otherwise. The tests assert both.
- **The status region** is `role="status"`, mounted for the component's whole life and empty while closed. It holds `@label` while open. The tests assert the text and that there is exactly one status element: the spinner's own role is replaced with `presentation` and hidden.
- **`@lock`** sets `inert` on the content only while open, and clears it when loading ends. The tests assert all three states and that `inert` stays off without `@lock`.
- **The scrim is `aria-hidden`**. It is decoration, and the status region carries the meaning.
- **Say what is loading.** "Loading" is the fallback, but "Saving billing details" tells a screen reader user what they are waiting for. The label is the caller's to write.
- **Focus is the caller's job.** If the element that had focus becomes inert under `@lock`, focus moves to the body. Return it when the work finishes if it matters.

## Theming

`--pretui-loading-overlay-mix` (how opaque the scrim is: `--card` mixed with transparent, default 72%), `--pretui-loading-overlay-blur` (the `@blur` radius, default 3px), `--card`, `--foreground` (spinner ink), `--muted-foreground` (the painted label), `--text-ui-sm`, `--space-2` (the gap between spinner and label), `--pretui-dur-snap` and `--pretui-ease-snap` (the fade-in).

The scrim mixes against `--card`, so a dark season gets a dark scrim without asking. The fade-in is skipped under `prefers-reduced-motion`. Covering the region edge to edge and inheriting its corner radius are fixed.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                              | Give them                              |
| ---------------------------------------- | -------------------------------------- |
| Mantine `<LoadingOverlay visible>`       | `@open`                                |
| Ant `<Spin spinning tip>` around content | `@open` + `@label` + `@showLabel`      |
| `overlayProps={{ blur }}`                | `@blur`                                |
| `loaderProps={{ size }}`                 | `@size`                                |
| `zIndex`                                 | not needed: the overlay stacks locally |
