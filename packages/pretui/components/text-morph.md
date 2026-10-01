## What it is

A string changing into another string, with the shared letters kept in place.

It is the clearest case in the kit of motion that carries meaning rather than decorating: **the transition *is* the information.** Which letters survive tells you how the two strings relate — that "draft" became "drafted" rather than being replaced by an unrelated word.

## The contract

```
@text (required) — the CURRENT string; changing it is what triggers a morph
@from?           — the string being morphed FROM, stated explicitly
@duration?       — seconds one glyph takes to leave or arrive. Default 0.32
@stagger?        — seconds between consecutive glyphs. Default 0.012;
                   0 gives a single simultaneous swap
```

**Changing `@text` triggers the morph.** The component remembers what it was showing, so a caller never has to pass both halves.

**`@from` is the better path when you have it.** Supply it and the render is a pure function of the arguments with no memory involved — preferable wherever the caller already holds both strings, and the only version that behaves identically on a re-render.

**`@stagger` at 0.012 is deliberately small.** This is not an entrance effect; the glyphs should read as one word rearranging, not as a wave crossing a line.

## Prior art

**motion-primitives' TextMorph.**

Where Pretui is better: **`@from` exists.** The upstream is memory-only, which means a component that re-mounts morphs from nothing, and a test cannot assert on a morph without driving a state change first. Making the source string statable turns the whole thing into a pure function. The schedule is also CSS rather than a frame loop.

Where it is thinner: the shared-letter matching is positional rather than a real diff, so two strings that share letters in a different order will not find them. There is no per-glyph colour or emphasis during the morph, and no way to morph between strings of wildly different lengths gracefully — the stagger runs over the longer of the two.

## Accessibility

- **The glyph stack is `aria-hidden` and the current string is mirrored in a visually-hidden span.** A string chopped into one span per glyph is not text to a screen reader — it is a pile of letters, and several engines will spell it out.
- **The mirror carries `@text`, the destination**, so assistive technology is told what the value *is* rather than what it was.
- **Reduced motion lands on the end state**, never a frozen midpoint. The base styles are the end state and the keyframes only supply the journey, so `animation: none` is a complete kill switch.
- **The meaning the morph carries is visual only.** A sighted reader learns that the two strings are related from the letters that stayed; a screen-reader user just gets the new value. If the relationship matters, it needs saying.
- **Rapid changes overlap.** A value updating faster than `@duration` leaves glyphs mid-flight; this is a component for occasional changes, not for a live counter.

## Theming

`--pretui-morph-dur` (from `@duration`), `--pretui-morph-step` (from `@stagger`), `--pretui-morph-i` (each glyph's index).

No colour tokens: the morph inherits ink and typeface from context, which is what makes it usable inside a heading or a table cell without looking like a widget. A season affects it only through the text around it.
