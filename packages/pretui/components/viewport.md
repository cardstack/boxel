## What it is

The artboard: a framed stage that renders its content at a chosen device width, with a caption stating the real width. Use it around any example that needs to be seen at a size other than the page's — every **FreestyleUsage** example sits in one. If you just need a bounded box, plain CSS is enough; Viewport is for _comparing_ a component across widths.

## The contract

```
@defaultMode? 'fill' | 'phone' | 'tablet' | 'desktop' | 'bp' | 'inline' | 'grid' | 'narrow' | 'wide'
@label?   — artboard caption; renders "Name · <width>"
<:default>
```

**True widths that pan rather than clamp.** A `phone` artboard is genuinely 390px wide and the stage scrolls horizontally to show it, rather than scaling the content down or clamping to the available space. That is the difference between an artboard and a resized div: a clamped preview lies about what the component does at that width, and a scaled one lies about its type size.

**`bp` is a 3-up mode** — three breakpoints side by side, which is how you actually check a responsive component.

**The caption is live**: `"Name · 390px"`, updating as the drag handle moves. An artboard whose label does not track its real width is worse than no label, because it invites you to trust it.

**The drag handle uses pointer capture, not document listeners.** Same discipline as **Popover**'s backdrop and **SplitPanes**' handle: the element's lifetime is the interaction's lifetime, so there is nothing to leak and nothing to remove on teardown.

State is reflected as `data-*`, so a season or a test can read the current mode.

## Prior art

Built against the kit's artboard contract (Appendix H). The comparison set is design tooling rather than component libraries: **Storybook's viewport addon** (a dropdown of device presets that resizes the preview iframe), **Figma's frames**, and **Chrome DevTools' device toolbar**.

Where this differs from Storybook's viewport addon, which is the closest analogue:

- **Storybook scales the iframe** to fit the panel by default; this pans. Scaling makes 12px type look like 9px type and hides exactly the legibility problems you opened the phone preset to find.
- **The caption is honest and live.** Storybook shows the preset name, not the measured width.
- **A drag handle for arbitrary widths**, not only presets — which is how you find the width where a layout actually breaks, as opposed to confirming it works at three widths someone chose.
- **A 3-up mode** with no analogue in Storybook.

Where it is thinner: no device chrome, no orientation toggle, no zoom, and no device-pixel-ratio simulation.

## Accessibility

No pattern governs it; it is a tool, and the criteria are WCAG **2.1.1 Keyboard**, **2.5.7 Dragging Movements** and **1.4.10 Reflow**.

Gaps, and the first two are the ones that matter for a tool:

- **The drag handle needs a keyboard path.** A width control operated only by dragging is a **WCAG 2.1.1** failure and, separately, a **2.5.7 Dragging Movements** failure — 2.5.7 specifically requires a single-pointer alternative, which keyboard support does _not_ satisfy. The mode presets are the pointer alternative for the common cases, so 2.5.7 is arguably met; arrow keys on a focused handle would close 2.1.1. Verify whether the handle is focusable at all.
- **The handle should be `role="separator"` with `aria-valuenow`/`min`/`max` and an accessible name** — the same contract **SplitPanes**' divider needs, and the same one to check.
- **The live caption is not a live region**, so a screen-reader user dragging (or arrowing) the handle gets no width feedback. Since the caption exists and is already updating, wrapping it in `role="status"` is nearly free — though it would then chatter during a drag, so `aria-valuenow` on the handle is the better channel.
- **The panning stage needs `tabindex="0"`** if it scrolls horizontally, or a keyboard-only user cannot pan a `desktop` artboard inside a narrow page.
- **Mode presets are presumably a SegmentedControl**, which in this kit carries `role="tablist"` over children with no `role="tab"` — see that component's note. The mode choice may be announced as an unstructured group of buttons.
- **The framed content is arbitrary**, so anything inside keeps its own tab order — which means tabbing through a 3-up view traverses three copies of the same component. That is expected for a tool and worth knowing.

## Theming

Stage and gutter surfaces (`--canvas` or `--inset`), the frame's `--border` and `--pretui-shadow-card`, `--muted-foreground` for the caption, and **SegmentedControl**'s tokens for the mode picker.

**The stage is deliberately neutral** with explicit surface and gutter settings, because an artboard that shares the page's background makes the framed component's own surface invisible. A season must keep the stage distinguishable from `--card` — otherwise every example appears to float in nothing, which is exactly the illusion an artboard exists to prevent.
