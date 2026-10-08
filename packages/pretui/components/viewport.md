## What it is

The artboard: a framed stage that renders its content at a chosen device width, with a caption stating its width. Use it around any example that needs to be seen at a size other than the page's — every **FreestyleUsage** example sits in one. If you just need a bounded box, plain CSS is enough; Viewport is for _comparing_ a component across widths.

## The contract

```
@defaultMode? 'fill' | 'phone' | 'tablet' | 'desktop' | 'bp' | 'inline' | 'grid'
              ('narrow' and 'wide' are kept as aliases for 'phone' and 'desktop')
@label?   — the specimen's name, captioning a dragged width as "Name · <width>"; presets are captioned by mode
<:default>
```

**True widths that pan rather than clamp.** A `phone` artboard is genuinely 320px wide and the stage scrolls horizontally to show it, rather than scaling the content down or clamping to the available space. That is the difference between an artboard and a resized div: a clamped preview lies about what the component does at that width, and a scaled one lies about its type size.

**`bp` is a 3-up mode** — three breakpoints side by side, which is how you actually check a responsive component. **`inline`** sets the specimen inside a line of running text, to judge it mid-paragraph. **`grid`** repeats it in six cells, for density.

**The stage** takes one of four surfaces (Background, a translucent veil of the page color; Card; Sidebar; Inset) and an optional Padding. Both apply to the framed modes and the grid cells; Inline sits in prose, so the two controls are disabled there.

**The caption is live**: `"Phone · 320px"` for a preset, `"Fill · 100%"` for the full width, and `"Name · 412px"` once you drag or use the width slider, updating as it moves. A dragged width belongs to Fill, so clicking a preset afterwards always resets it. An artboard whose label does not track its real width is worse than no label, because it invites you to trust it.

**The drag handle uses pointer capture, not document listeners.** Same discipline as **Popover**'s backdrop and **SplitPanes**' handle: the listeners live on the handle, so teardown only unbinds them and clears the resize flag. Only the primary button starts a drag.

State is reflected as `data-*`, so a theme or a test can read the current mode.

## Prior art

Built against the kit's artboard contract. The comparison set is design tooling rather than component libraries: **Storybook's viewport addon** (a dropdown of device presets that resizes the preview iframe), **Figma's frames**, and **Chrome DevTools' device toolbar**.

Where this differs from Storybook's viewport addon, which is the closest analogue:

- **Storybook scales the iframe** to fit the panel by default; this pans. Scaling makes 12px type look like 9px type and hides exactly the legibility problems you opened the phone preset to find.
- **The caption is honest and live.** Storybook shows the preset name, not the measured width.
- **A drag handle for arbitrary widths**, not only presets — which is how you find the width where a layout actually breaks, as opposed to confirming it works at three widths someone chose.
- **A 3-up mode** with no analogue in Storybook.

Where it is thinner: no device chrome, no orientation toggle, no zoom, and no device-pixel-ratio simulation.

## Accessibility

No pattern governs it; it is a tool, and the criteria are WCAG **2.1.1 Keyboard**, **2.5.7 Dragging Movements** and **1.4.10 Reflow**.

- **The width slider is the keyboard path.** The drag handle is a redundant pointer target, hidden from assistive tech and not focusable; the **Slider** beside it sets the same width with the arrow keys (5px steps), Page Up/Down and Home/End, and announces it as "N pixels". The presets and a click on the slider track are the single-pointer alternatives 2.5.7 asks for.
- **The canvas is a named region with a tab stop** ("Artboard canvas"), so a keyboard user can pan a `desktop` or 3-up artboard that is wider than the page.
- **The mode picker is a SegmentedControl** (a radiogroup named "Viewport mode"). In a panel narrower than its seven segments it scrolls on its own instead of widening the page.
- **In Fill, 3-up, Inline and Grid the slider reads its 240px minimum**, since those modes have no single fixed width to report.
- **The live caption is not a live region**, so dragging gives a screen-reader user no width feedback; the slider's announced value is the channel.
- **The framed content is arbitrary**, so anything inside keeps its own tab order: tabbing through a 3-up view traverses three copies of the component, and Grid six. That is expected for a tool and worth knowing.

## Theming

Stage surfaces (`--background`, `--card`, `--inset`, and `--sidebar` / `--sidebar-foreground` / `--sidebar-border`), `--border` for frames and the canvas dots, `--shadow-sm` on the card surface, `--border-strong` for the resize grip, `--primary-ink` for the artboard caption and the hovered grip, `--muted-foreground` for the width readout and the Padding label, a translucent `--background` veil over the dot floor on the Background surface, and and the tokens of the **SegmentedControl**, **Select**, **Switch** and **Slider** in the toolbar.

**The stage is deliberately neutral** with explicit surface and padding settings, because an artboard that shares the page's background makes the framed component's own surface invisible. A theme must keep the stage distinguishable from `--card` — otherwise every example appears to float in nothing, which is exactly the illusion an artboard exists to prevent.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
