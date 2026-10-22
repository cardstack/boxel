## What it is

**Slider** with range mode forced on, under the name Mantine, Ant and MUI use for the two-thumb case. Unlike the kit's other alias names this is a thin wrapper, not a re-export: it renders `Slider` with range mode switched on and forwards only the range-mode args, so a port that always passes a pair gets a component whose types say so. The engine, the keyboard model, the accessibility and the theming are Slider's; the single-thumb story and the depth are on **Slider**.

## The contract

```
@values?, @defaultValues?     — the [lower, upper] pair, controlled or seeded
@onValuesChange?              — fires with the whole next pair
@onRangeChange?               — the Radix / Mantine spelling of the same callback
@label?                       — becomes aria-label on both thumbs
@min? (0), @max? (100), @step? (1)
@interval?                    — snap to a derived ladder and widen the rail to its boundaries
@formatValue?                 — feeds aria-valuetext and derived tick labels
@ticks?, @maxTicks? (12)      — visible tick labels, and the cap on derived ones
```

**The single-value args are not forwarded.** `value`, `defaultValue` and the single-value notify pair are absent from the signature, because a range slider has no single value; passing them is a type error rather than a silent no-op.

**Each thumb clamps against its sibling**, so an over-drag parks on the neighbour instead of doing nothing.

## Prior art

**Mantine `RangeSlider`** is a separate component with `value: [number, number]`, `minRange` / `maxRange`, `pushOnOverlap`, `marks`, `label` (the tooltip formatter) and `thumbFromLabel` / `thumbToLabel`. **Ant `Slider range`** and **MUI `Slider value={[a, b]}`** switch the one component into two-thumb mode from the shape of the value; MUI adds `disableSwap`. **Radix `Slider`** models every slider as `number[]` and offers `minStepsBetweenThumbs`.

Where this is better: two native range inputs on one rail, so arrows, PageUp/PageDown, Home/End, touch and pointer capture are the platform's; the rail ignores the pointer and only the thumbs take it, so the two never swallow each other's drags; when the thumbs coincide the trapped one is raised, not always the lower.

Where it is thinner: no `minRange` / `minStepsBetweenThumbs`, no `pushOnOverlap`, no tooltip, no vertical orientation. A two-element `value` does not imply range the way MUI's does — the pair is `@values`, and a caller porting `value={[a, b]}` renames it.

## Accessibility

Slider's, doubled: each thumb is a native `<input type='range'>`, so `role='slider'`, `aria-valuenow` / `min` / `max` and the full APG key list arrive from the browser. `@label` names both thumbs the same, so always pass one that reads well twice; `@formatValue` feeds `aria-valuetext` so a reader hears "1960", not "2" on a stepped ladder. The 14px thumbs sit under WCAG 2.5.8's 24px target minimum.

## Theming

Slider's: `--primary` (the filled span between the thumbs), `--line-strong` (rail and thumb hairline), `--card` (thumb fill), `--shadow-ink-mid` (thumb shadow), `--font-mono` and `--ink-3` (tick labels). Nothing is themed under a RangeSlider name.

## React ecosystem

| Mantine / Ant / MUI / Radix                                            | Pretui                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `value={[a, b]}` / `defaultValue`                                      | `@values` / `@defaultValues`                                |
| `onChange` / `onValueChange` (pair)                                    | `@onValuesChange`, or `@onRangeChange`                      |
| `min` / `max` / `step`                                                 | the same                                                    |
| `marks`                                                                | `@ticks`, or `@interval` for a derived ladder               |
| `label` (tooltip formatter)                                            | `@formatValue` (aria-valuetext and tick labels; no tooltip) |
| `minRange` / `minStepsBetweenThumbs` / `pushOnOverlap` / `disableSwap` | not offered                                                 |
