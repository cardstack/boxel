## What it is

A QR code generated from a value, with the encoded value also present as text or a link — never only as a symbol.

## The contract

```
@value?           — the payload: a URL, an id, a vCard, anything under ~2 KB
@label?           — accessible name for the symbol. Defaults to 'QR code'
@errorCorrection? — ISO/IEC 18004 level. 'M' by default; forced to 'H' with @overlay
@margin?          — quiet zone in modules, clamped to [4, 16]
@size?            — rendered edge length in px, clamped to [64, 1024]. Default 180
@foreground?, @background? — opaque hex only
@valueDisplay?    — how the encoded value appears as text: 'auto' (default) renders
                    an anchor for http(s) values and selectable code text otherwise;
                    'link' and 'text' force one; 'none' keeps it visually hidden but
                    still in the accessibility tree
@caption?         — caption under the symbol; the <:caption> block wins
@overlay?         — declares that an <:overlay> mark is being supplied
@onRender?        — called with what was actually rendered

<:caption> — replaces @caption
<:overlay> — a mark centred over the symbol; requires @overlay={{true}}
```

**The encoded value is never removed outright.** `@valueDisplay='none'` hides it visually and keeps it in the accessibility tree, because a QR code alone is unusable to anyone who cannot point a camera at the screen they are already looking at.

**`@overlay` is a flag *and* a block, and the flag is what does the work.** Named blocks are not visible from component JavaScript, so the flag is what raises error correction to `'H'` and reserves the centre. The block renders **only** when the flag is set — so forgetting it makes the overlay visibly vanish rather than silently producing an unscannable code.

**The quiet zone lives in the `viewBox`, not in CSS padding**, so a caller cannot style away the margin the symbol needs in order to scan — the prior version accepted `margin: 0` and stretched the symbol to fill whatever box it was in besides.

**The occluded area is capped at 20% of the symbol's edge** — about 4% of its area, well inside level H's ~30% budget.

**Colours are opaque hex only.** A QR code with a translucent foreground is a QR code that does not scan.

## Prior art

**`wa-qr-code`.**

Where Pretui is better: the value is always available as text, the overlay raises error correction automatically rather than leaving the caller to know that it must, and the failure mode of forgetting the flag is visible rather than silent.

Where it is thinner: no logo sizing control beyond the cap, no module-shape styling (rounded dots and the like), and no export — the symbol is rendered, not downloadable.

## Accessibility

- **A QR code is not accessible content.** It is an image of a machine-readable string, and the only accessible version of it is the string. That is why `@valueDisplay` has no option that removes it.
- **`@label` names the symbol, not the payload.** The value is exposed separately, so repeating it in the label is noise — which is why the default is the generic "QR code".
- **`'auto'` renders an anchor for http(s) values**, which means the destination is reachable by keyboard on the same screen rather than requiring a second device.
- **The quiet zone is clamped to the spec minimum and lives in the `viewBox`**, so a code cannot be rendered — or styled — in a way that fails to scan.
- **`@onRender` reports what was actually produced**, which is how a caller detects that a payload was too large before a user finds out with a camera.

## Theming

`@foreground` and `@background` are args rather than tokens, and opaque hex rather than any CSS colour — a deliberate departure from the kit's usual token channel, because contrast here is a functional requirement rather than an aesthetic one and a season must not be able to break scanning.

Everything around the symbol — the caption, the value text, the link — takes the normal kit tokens.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
