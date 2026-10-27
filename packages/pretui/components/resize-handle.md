## What it is

A focusable separator that resizes the pane beside it, in px. Use it to size one pane next to content that keeps its own layout: a filter rail beside a grid, an inspector beside a canvas, a console under an editor. To share out a whole group of panes in percent, use **SplitPanes**. For an app rail that collapses and turns into a drawer on narrow panes, use **Sidebar**.

## The contract

```
@size? (px), @onSizeChange(px)
@min? (0), @max?, @defaultSize?        px numbers, or 'Npx' / 'Nrem' strings
@orientation? 'vertical' (default) | 'horizontal'
@placement? 'end' (default) | 'start' | 'left' | 'right' | 'top' | 'bottom'
@step? (16), @label? ('Resize'), @controls?
```

Three decisions worth understanding.

**The handle is controlled, and it doesn't touch the pane.** `@onSizeChange` reports the next size, already clamped to `@min`/`@max` and rounded to whole px; the caller writes it wherever its layout reads a size (usually a custom property on the pane) and passes it back as `@size`. So the size can live in a card field, a service or `localStorage`, and the handle has no opinion about which. An unset `@size` reads as `@defaultSize`, so a caller can leave its CSS default in charge until the first resize.

**Bounds take rem.** A pane designed in rem keeps its bounds in rem: `@min='11rem'` resolves against the root font size, read afresh at each drag and key press, so a change to it takes effect on the next one. The reported size is always px, since that's what a drag measures.

**The caller places it.** The handle is a strip (`--pretui-resize-handle-size`, 0.5rem; 1rem on a coarse pointer) that fills its cross axis. Position it on the pane's edge, usually absolutely, inside the pane, so it travels with the edge it moves. `@placement` names that edge, so the handle knows which way growing is, and the painted line runs along the strip's side on that edge. When the strip is too thin to be an easy target, `--pretui-resize-handle-outset` extends its hit area past the edge, over a neighbor's gutter, without the pane setting aside more room: a 0.5rem strip with a 1rem outset is a 24px target. `start` and `end` are logical, so in a right-to-left context the drag flips with them; `left` and `right` are physical and never flip; `top` and `bottom` name the block axis, which the writing direction doesn't affect.

## Prior art

`react-resizable-panels` (shadcn's `Resizable`) and Web Awesome's `wa-split-panel` both own the whole group: they lay out the panes and the divider between them. That's **SplitPanes** here. This handle is the part they don't expose on its own: a separator for one pane whose size the caller already owns. Sidebars in VS Code, Linear and Figma work this way: a fixed-width panel with a draggable edge, while the rest of the window keeps its own layout.

Where it earns its place:

- **Keyboard resizing.** Arrow keys step, Shift steps four times as far, Home/End go to the limits and Enter restores the default, which SplitPanes' handle can't do.
- **It says where it is.** `aria-valuenow`/`min`/`max` report the size, so a screen reader hears it.
- **Absolute units.** px and rem bounds, not percentages of a group.
- **Total travel, not frame deltas.** Each move applies the distance from where the drag started, so rounding never drifts over a long drag. The pointer that started a drag owns it: a second finger neither restarts nor steers it, and losing pointer capture ends it. A release the handle never sees can't leave it stuck: a move with no button held ends the drag, and a fresh press from the same pointer starts it over.
- **It works under a scaled ancestor.** Pointer travel is converted to the pane's own px using the handle's on-screen size over its layout size, so the edge stays under the pointer in a zoomed canvas or a scaled preview.

Where it's thin: no collapse (pair it with a toggle, as Sidebar does), no snap points, and no persistence of its own.

## Accessibility

It follows the WAI-ARIA window splitter pattern: `role='separator'` with `tabindex='0'`, which makes the separator an interactive widget.

- `aria-orientation` is the line's own orientation. `aria-valuenow`, `aria-valuemin` and `aria-valuemax` are the pane's size and bounds in px. With no `@max`, `aria-valuemax` is the viewport's width (height, for a horizontal handle), or the pane's size if that's larger, since assistive tech reads a missing max as 100.
- `@label` is the accessible name. Name the pane: "Resize sidebar", not "Resize".
- `@controls` sets `aria-controls` to the pane's id.
- Keys: Left/Right for a vertical handle and Up/Down for a horizontal one, following the screen (in a right-to-left context, the key toward the pane's end edge still grows it). Home and End go to the min and max. A key pressed with Alt, Ctrl or Meta is left to the browser (Alt+Left is Back).
- Double-click or Enter restores `@defaultSize`. With no `@defaultSize`, both do nothing.
- Pressing the handle focuses it, and a drag doesn't select the page's text.

## Theming

The painted line is `--primary-ink` while the handle is pointed at (on a device that hovers) or dragged, and the focus ring is `--ring`. At rest the strip is transparent, so the pane's own border draws the edge. The strip's thickness is `--pretui-resize-handle-size`, and `--pretui-resize-handle-outset` (default 0) is how far its hit area reaches past the pane's edge.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS (the positioning, most often) overrides them without a more specific selector.
