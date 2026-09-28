## What it is

A semantic separator between groups of adjacent content, horizontal or vertical, plus the centred-label variant — the "or" rule between two form alternatives — that every product page hand-rolls.

It is the kit's smallest component, and it earns its slot by ending ad-hoc `<hr>` styling: one rule, one hairline token, one spacing token, restyled by a season with no code. If you want a labelled boundary that also collapses its content, that is **PanelSection**; if you want spacing without a rule, that is layout, not this.

## The contract

```
@orientation? — 'horizontal' (default) | 'vertical'
@label?       — centred label; horizontal only
```

Two args, no state, no script.

**It is always a `<div role='separator'>`, never an `<hr>`.** The role and `aria-orientation` are set explicitly rather than inherited from the element, which is what lets one component serve both orientations without swapping tags.

**The horizontal rule is drawn by two flanking pseudo-elements, not by a border.** `::before` and `::after` each take `flex: 1`, so with no label they meet in the middle and read as a single line, and with a label they become the two hairlines either side of it. That is why the label needs no background to punch a hole in the rule — there is no rule under it to hide.

**A vertical divider ignores `@label`.** The label span is hidden, and the rule is a 1px column with `min-height: 1lh` so it has a height even between two short inline items.

**Spacing is one token, applied as a margin on the axis that matters** — block margins when horizontal, inline when vertical.

## Prior art

Transcribed from **Web Awesome's `wa-divider`**, with **React Spectrum's `Divider`** as the second reference; shadcn and Radix call the same thing `Separator` and take `orientation` and `decorative`.

Where Pretui is better: **the centred-label variant is built in.** Neither upstream ships it, and it is the one divider anybody actually hand-writes. Web Awesome's three custom properties — `--color`, `--width`, `--spacing` — collapse to a single `--pretui-divider-spacing`, because the hairline colour _is_ the `--border` token and a divider that does not match every other hairline in the product is a bug rather than a feature.

Where it is thinner, and these are real: **there is no `decorative` escape hatch.** Radix and Web Awesome both let a purely visual rule drop its separator semantics, and this one cannot — every divider is announced. **There is no width or size axis**: the hairline is 1px, full stop, where Spectrum offers a scale. **There are no inset or full-bleed presets** for list contexts, so a divider inside a padded list has to be positioned by its container. And **a vertical divider cannot be labelled**, which is correct for the layout but is a silent drop rather than a typed constraint.

## Accessibility

`role='separator'` with an explicit `aria-orientation` is the right shape, and the ARIA note that both upstreams follow. Three things are worth knowing:

- **Every divider is announced, including purely decorative ones.** With no `decorative` arg, a rule used for visual rhythm rather than grouping still reaches the accessibility tree. A page that uses several as ornament will announce several separators, and the only remedy today is `aria-hidden='true'` passed through `...attributes` at the call site.
- **`@label` becomes `aria-label` on the separator itself**, so a labelled rule announces as "or, separator" rather than as loose text — which is the intent.
- **A vertical divider with a `@label` keeps that `aria-label` while hiding the text.** The name is announced but never visible, which is a mismatch between what a sighted and a non-sighted user perceive. Passing `@label` to a vertical divider is a call-site mistake the component does not report.
- **A separator with a role is not focusable and takes no tab stop**, which is correct: `role='separator'` is only focusable when it is a splitter you can move, and this one never is.

## Theming

`--pretui-divider-spacing` (the margin on the divider's axis, defaulting to `--space-4`, 11px), `--border` (the hairline, in both orientations), `--muted-foreground` (the label ink), `--text-ui-sm` (11.5px), `--track-ui` (the label's letter-spacing).

The 1px thickness, the 8px padding either side of the label and the vertical rule's `1lh` minimum height are fixed.

A season changes the density of every divider in the product through `--pretui-divider-spacing` alone, and its colour through `--border` — which is shared, so dividers cannot drift away from the hairlines on cards, inputs and tables. That sharing is the deliberate trade: the kit gives up a per-divider colour knob to guarantee that every hairline in a season matches.
