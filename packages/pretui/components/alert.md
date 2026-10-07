## What it is

An inline banner carrying a tone: something succeeded, something needs attention, something failed. It sits **in the flow of the page**, next to the thing it is about. Use it for state that persists — a form-level failure, a warning about a record's condition, a note about what a panel is showing. If the message is transient and about an action just taken, use **Toast**. If it belongs to one field, use **FieldError**. If it is the whole content of an empty region, use **EmptyState**.

**Callout** is this same class re-exported under another name, and `callout.md` documents it too, so a change to the tones, roles, glyph or tone word here must also be made there.

## The contract

```
@tone? 'info' | 'success' | 'warning' | 'danger'   (default 'info')
@title?
@toneLabel?   (default by tone: 'Info' | 'Success' | 'Warning' | 'Error')
<:default>  <:action>
```

**One hue in, a complete treatment out.** This is the kit's Law 2, and Alert is its clearest expression: `@tone` selects the hue, ink and on-hue custom properties (`--pretui-alert-hue`, `--pretui-alert-ink`, `--pretui-alert-on-hue`), and the stylesheet derives the tints from the hue with `color-mix` — a 20% tint over `--card` for the background, a 25% mix with `--border` for the hairline, and the hue neat for the glyph disc. Text uses the tone's `-ink` token and the glyph uses the fill's paired `-foreground`. No semantic hexes are baked in anywhere. Adding a fifth tone is one entry in the color map.

Each tone has its own icon from `@cardstack/boxel-icons` (Info, Check, Alert Triangle and X), painted in the tone's `-foreground`. **FieldError** and **ErrorSummary** mark severity with their own glyphs and the same four hues, so a field message, a summary row and a banner about the same thing still read as one system.

**The role flips with the tone**: `danger` gets `role="alert"` (assertive), everything else gets `role="status"` (polite). That is a real decision, not a default — see below.

## Prior art

**Web Awesome `wa-callout`** takes `variant` (`brand|success|neutral|warning|danger`), `appearance` (`accent|filled|outlined|plain`) and `size`, with icon and default slots — a fuller treatment grid, and no ARIA at all (it is presentational by design, leaving the live-region decision to the caller). **shadcn `Alert`** is `default`/`destructive` with `AlertTitle`/`AlertDescription` and hardcodes `role="alert"` on every instance. **React Spectrum `InlineAlert`** has `variant` (`neutral|info|positive|notice|negative`) and, notably, `autoFocus` — it moves focus to itself rather than relying on a live region.

Where Pretui is better than shadcn: **shadcn puts `role="alert"` on an informational banner**, which means an assertive interruption for a message that says "3 records imported". Pretui's tone-driven role is the right granularity — assertive for failures, polite for everything else — and it costs one getter.

Where Pretui is better than Web Awesome: the `color-mix` derivation. Web Awesome's variants are enumerated stylesheets; a new tone means a new block. Here the recipe is written once.

Where it is thinner: no `appearance` axis (Web Awesome's outlined/plain callouts have no equivalent), no dismiss affordance, no icon slot — the icon is fixed per tone.

## Accessibility

Governing pattern: APG **Alert** (`role="alert"`, nothing else required) and the live-region rules generally.

What is right: the assertive/polite split by tone, and the fact that both `alert` and `status` carry implicit `aria-atomic="true"`, so the whole banner is re-read rather than just the changed fragment. The glyph is `aria-hidden`, so the banner is not announced as an image first. The role alone cannot carry the tone: it singles out `danger`, and `info`, `success` and `warning` all share `role="status"`. So a visually hidden tone word sits where the glyph is, and the banner is announced as "Warning: Low credit", the way GOV.UK's warning text carries a hidden "Warning". `@toneLabel` replaces the word, for a translation or a more exact one such as "Caution" on a delete confirmation.

Gaps, and one is significant:

- **The live region is created together with its content.** A live region must exist in the DOM _before_ its content changes to be reliably announced. `{{#if this.showAlert}}<Alert>` mounts the region and its text in the same frame, and several screen readers will say nothing. `role="alert"` is partly exempt — some readers do announce alerts inserted with content already present — but `role="status"` generally is not, so **`info`/`success`/`warning` alerts frequently announce nothing at all**. The fix is the pattern React Aria and Web Awesome both use: one persistent, empty, visually-hidden region that messages are written into. Render the Alert always and toggle its content, or pair it with such a region.
- **`role="alert"` on a persistent banner is wrong in the other direction.** An Alert that is always present (a standing warning on a record) will be announced on every re-render that touches it. Alerts are for messages that _appear_.
- **Contrast is derived, not verified.** Text is the tone's `-ink` token (the hue mixed toward `--foreground`) on a `color-mix(hue 20%, --card)` background. The glyph disc pairs each fill with its `-foreground`. That reads well for the default palette and is not guaranteed for an arbitrary theme: nothing verifies the ink against the tint.
- No dismiss control, so nothing to make keyboard-accessible — which is the honest upside of the smaller API.

## Theming

`--info`, `--success`, `--warning`, `--destructive` (the four tone hues); `--info-ink`, `--success-ink`, `--warning-ink`, `--destructive-ink` (text); `--info-foreground`, `--success-foreground`, `--warning-foreground`, `--destructive-foreground` (the glyph's ink on its disc); `--card` (the mix base), `--border` (mixed into the hairline), and the `--boxel-sp-*`, `--boxel-border-radius` and `--boxel-font-size-xs` tokens for geometry and type. The 20% tint strength is the component's own `--pretui-alert-mix`, set on `.pretui-alert`; a caller can override it per instance.

A theme retunes the entire component by retuning those four hues. Because every derived colour is a mix against `--card`, a dark theme gets correct dark treatments automatically, but it **must** define the four hues at a luminance that survives a 20% mix against a dark `--card`, or all four alerts converge on the same near-black rectangle.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

Tremor/WA `Callout` is this component under that name (**Callout**). shadcn Alert is too
(but they hardcode `role=alert` on info — we do not). Page-level
outcome is **Result**. Transient is **Toast**.
