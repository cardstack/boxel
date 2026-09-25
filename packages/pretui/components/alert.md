## What it is

An inline banner carrying a tone: something succeeded, something needs attention, something failed. It sits **in the flow of the page**, next to the thing it is about. Use it for state that persists — a form-level failure, a warning about a record's condition, a note about what a panel is showing. If the message is transient and about an action just taken, use **Toast**. If it belongs to one field, use **FieldError**. If it is the whole content of an empty region, use **EmptyState**.

## The contract

```
@tone? 'info' | 'success' | 'warning' | 'danger'   (default 'info')
@title?
<:default>  <:action>
```

**One hue in, a complete treatment out.** This is the kit's Law 2, and Alert is its clearest expression: `@tone` selects a single custom property (`--pretui-alert-hue`), and the stylesheet derives _everything_ from it with `color-mix` — a 20% tint over `--card` for the background, a 25% mix with `--border` for the hairline, a 40% mix with `--foreground` for the body ink, 55% for the title, and the hue neat for the glyph disc. No semantic hexes are baked in anywhere. Adding a fifth tone is one line in the hue map.

The glyph vocabulary (`i` / `✓` / `!` / `✕`) is shared with **FieldError** and **ErrorSummary**, so a field message, a summary row and a banner about the same thing read as one system.

**The role flips with the tone**: `danger` gets `role="alert"` (assertive), everything else gets `role="status"` (polite). That is a real decision, not a default — see below.

## Prior art

**Web Awesome `wa-callout`** takes `variant` (`brand|success|neutral|warning|danger`), `appearance` (`accent|filled|outlined|plain`) and `size`, with icon and default slots — a fuller treatment grid, and no ARIA at all (it is presentational by design, leaving the live-region decision to the caller). **shadcn `Alert`** is `default`/`destructive` with `AlertTitle`/`AlertDescription` and hardcodes `role="alert"` on every instance. **React Spectrum `InlineAlert`** has `variant` (`neutral|info|positive|notice|negative`) and, notably, `autoFocus` — it moves focus to itself rather than relying on a live region.

Where Pretui is better than shadcn: **shadcn puts `role="alert"` on an informational banner**, which means an assertive interruption for a message that says "3 records imported". Pretui's tone-driven role is the right granularity — assertive for failures, polite for everything else — and it costs one getter.

Where Pretui is better than Web Awesome: the `color-mix` derivation. Web Awesome's variants are enumerated stylesheets; a new tone means a new block. Here the recipe is written once.

Where it is thinner: no `appearance` axis (Web Awesome's outlined/plain callouts have no equivalent), no dismiss affordance, no icon slot — the glyph is fixed per tone.

## Accessibility

Governing pattern: APG **Alert** (`role="alert"`, nothing else required) and the live-region rules generally.

What is right: the assertive/polite split by tone, and the fact that both `alert` and `status` carry implicit `aria-atomic="true"`, so the whole banner is re-read rather than just the changed fragment.

Gaps, and one is significant:

- **The live region is created together with its content.** A live region must exist in the DOM _before_ its content changes to be reliably announced. `{{#if this.showAlert}}<Alert>` mounts the region and its text in the same frame, and several screen readers will say nothing. `role="alert"` is partly exempt — some readers do announce alerts inserted with content already present — but `role="status"` generally is not, so **`info`/`success`/`warning` alerts frequently announce nothing at all**. The fix is the pattern React Aria and Web Awesome both use: one persistent, empty, visually-hidden region that messages are written into. Render the Alert always and toggle its content, or pair it with such a region.
- **The glyph is not `aria-hidden`.** The literal characters `i`, `✓`, `!`, `✕` are inside a `<span>` in the announced content, so a danger alert may be read as "multiplication x" or "letter i" before the title.
- **`role="alert"` on a persistent banner is wrong in the other direction.** An Alert that is always present (a standing warning on a record) will be announced on every re-render that touches it. Alerts are for messages that _appear_.
- **Contrast is derived, not verified.** Body ink is `color-mix(--foreground 40%, hue)` on a `color-mix(hue 20%, --card)` background. That reads well for the default palette and is not guaranteed for an arbitrary season hue — a light amber `--warning` produces low-contrast body text with nothing to catch it.
- No dismiss control, so nothing to make keyboard-accessible — which is the honest upside of the smaller API.

## Theming

`--pretui-info`, `--success`, `--warning`, `--destructive` (the four tone hues); `--card` (the mix base and the glyph's ink), `--foreground` (mixed into title and body), `--border` (mixed into the hairline), `--pretui-chip-mix` (the tint strength, default 20%, shared with **Chip** so banners and chips tint identically), `--text-ui-md`.

A season retunes the entire component by retuning those four hues plus `--pretui-chip-mix`. Because every derived colour is a mix against `--card`, a dark season gets correct dark treatments automatically — but it **must** define the four hues at a luminance that survives a 20% mix against a dark `--card`, or all four alerts converge on the same near-black rectangle.

## React ecosystem

Tremor/WA `Callout` is this component under that name (**Callout**). shadcn Alert is too
(but they hardcode `role=alert` on info — we do not). Page-level
outcome is **Result**. Transient is **Toast**.
