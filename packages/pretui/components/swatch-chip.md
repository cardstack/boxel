## What it is

The colour face alone: a `<span>` that draws one colour, with no semantics, no accessible name and no tab stop. It is the smallest colour surface in the kit.

It exists because a colour chip appears in two structurally different places — as the whole of an interactive **Swatch**, and as decoration *inside* someone else's control (the **ColorField** trigger, a row in **GradientEditor**). A `<button>` inside a `<button>` is invalid HTML and a real keyboard trap; realm lint rejects it as `no-nested-interactive`, and `tabindex='-1'` on the inner one is a workaround rather than a fix. One presentational primitive used by both is the fix.

So: reach for **Swatch** when the colour is the thing the user acts on, and for this when the colour is decoration on something else.

## The contract

```
@color (required) — any CSS colour; unparseable renders the empty state
@shape?           — 'round' (default) | 'square'
@size?            — chip size in px; defaults to the --pretui-swatch-size token
```

**The caller's characters never reach the style attribute.** `@color` is the one arg that is pure caller text destined for CSS, so it goes through the stronger of the two guards: the colour engine parses it and re-serialises a string built from numbers, and the kit's declaration allowlist is the second line of defence. Interpolating the string directly would let a `@color` of `red; background: url(…)` carry its own declarations — the parse-and-rebuild is what makes that impossible rather than merely unlikely.

**`@size` is clamped to 1–512px and rounded** before it becomes a declaration; omitting it leaves the token in charge, which is what keeps a grid of chips consistent.

**An unparseable colour is drawn, not hidden.** The chip switches to an empty state — a `--destructive` diagonal over the field ground — so a bad value in a record is visible as a bad value instead of silently rendering as transparent.

**The checkerboard sits *under* the colour, not beside it.** A 40%-opaque colour over a checker reads as translucent; the same colour composited onto a solid ground reads as a lighter solid colour, which is a lie the eye cannot catch. This is the detail that makes alpha legible.

## Prior art

There is no upstream for this one — it is a kit addition, and the comparison is against how a colour dot is usually done: a `<span>` with an inline `background` built by string concatenation at the call site. That approach has three problems this component removes. The caller's string reaches CSS unparsed. Alpha is invisible, because there is no checker under it. And when the colour is decoration inside a button, the call site tends to reach for a nested interactive element instead of a plain span.

Where it is thinner: there is no border or ring control — the inset hairline is fixed at `color-mix(--foreground 14%)` — and no size axis beyond a raw pixel number, where the rest of the kit uses named steps. A chip cannot show a gradient or a pattern either; it is one flat colour, and **GradientEditor** owns the multi-stop case.

## Accessibility

This component is deliberately invisible to assistive technology, and that is the correct answer for it — but it moves the responsibility rather than removing it.

- **No role, no name, not focusable.** The chip contributes nothing to the accessibility tree. Inside a **Swatch** or a **ColorField** trigger, the name lives on that control, which carries the hex and a colour word so the value is legible without seeing it.
- **Used alone, it is announced as nothing at all.** A grid of bare `SwatchChip`s is a grid of empty spans to a screen reader. If the chip is the only thing conveying a value, the value must also exist as text nearby, or the component is the wrong choice — **Swatch** is.
- **The empty state is conveyed by colour and shape only.** A caller who needs the "unparseable" condition to be perceivable non-visually has to surface it themselves; the chip has no text to carry it.
- **Colour alone is never sufficient** (WCAG 1.4.1). That is a constraint on the caller's layout, not something a presentational span can enforce.
- The chip honours `prefers-reduced-motion` by dropping its transition.

## Theming

`--pretui-swatch-size` (18px default; `@size` overrides per instance), `--pretui-swatch-color` (the parsed colour, written per instance), `--pretui-checker` (the alpha checkerboard, defaulting to a conic gradient mixed from `--foreground` at 11%), `--foreground` (the checker and the inset hairline at 14%), `--radius` (the square shape's corner, at a 2.5 divisor), `--destructive` and `--field` (the empty state).

A season changes every colour chip in the product by retuning `--pretui-swatch-size` and `--pretui-checker`. Because the checker and the hairline are both mixed from `--foreground`, a dark season inverts them automatically — but a season with a very low-contrast `--foreground` will lose the hairline, and a white swatch on a light `--card` then has no edge at all.
