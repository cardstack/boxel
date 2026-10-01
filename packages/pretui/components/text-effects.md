## What it is

One entrance choreography for text, with a preset knob, applied per character, word or line.

It is the consolidation of what upstream kits ship as a dozen near-identical components — fade-in, blur-in, rise-in, slide-in, per-letter, per-word — into one component with four axes.

## The contract

```
@text (required) — the string to reveal
@effect?         — which entrance. Default 'fade'
@per?            — the unit that gets its own animation. Default 'word'
@order?          — the sequence the stagger runs in. Default 'forward'
@stagger?        — seconds between one unit starting and the next. Default 0.04
@duration?       — seconds one unit takes. Default 0.5
@delay?          — seconds before the first unit moves. Default 0
@distance?       — travel in px for rise / fall / slide. Default 14
@blur?           — blur radius in px for the blur preset. Default 8
```

**`@stagger` and `@duration` are separate knobs, and most libraries ship one `speed` and stop.** They read completely differently: stagger is the rhythm across the line, duration is the weight of each unit. Tuning one without the other is how an entrance ends up either frantic or sludgy.

**`@per='word'` is the default rather than `'character'`**, because per-character is the showier choice and the wrong one for most text — a whole sentence revealing letter by letter is slow to read and expensive to animate.

**The whole schedule is a precomputed `animation-delay` per unit.** No frame loop, no timer, no engine: the compositor runs it off the main thread, and a re-render cannot stutter it.

## Prior art

**motion-primitives' TextEffect** and the per-character stagger family across react-bits and fancy.

Where Pretui is better: **one component instead of a dozen.** The upstream kits ship a separate component per effect, which means a product picks three and inherits three different arg vocabularies. Here the effect is a preset on one contract, so switching from fade to blur is a one-word change and every knob keeps its meaning.

Where it is thinner: no exit choreography, no custom keyframes beyond the presets, no per-unit override, and no loop. `@order` covers the common sequences but not an arbitrary permutation.

## Accessibility

- **The full string is mirrored in a visually-hidden span and the chopped-up animated copy is `aria-hidden`.** Without that, a per-character entrance is announced one character at a time, and a per-word one word at a time with no sentence.
- **The text is fully available before the animation finishes.** The mirror is in the tree from first paint.
- **Reduced motion collapses every preset to the finished line**, because the base styles are the end state and the keyframes only supply the choreography.
- **A long `@stagger` over a long string delays legibility for sighted readers only.** The accumulated delay is `units × stagger`; check it on your longest string, not your demo one.
- **The entrance conveys nothing.** Nothing about emphasis, order or importance should depend on it.

## Theming

`--pretui-fx-step` (from `@stagger`), `--pretui-fx-dur` (from `@duration`), `--pretui-fx-delay` (from `@delay`), `--pretui-fx-i` (each unit's index), `--pretui-fx-dist` (from `@distance`), `--pretui-fx-blur` (from `@blur`).

Every token is derived from an arg rather than being a seasonal value, which is deliberate: an entrance is a property of the moment, not of the theme. Colour and typeface come entirely from context, so the effect drops into a heading or a paragraph without carrying any appearance of its own.
