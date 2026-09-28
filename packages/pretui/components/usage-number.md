## What it is

The numeric argument row of a **FreestyleUsage** page — `Args.Number`. Docs lens: a table row. Property lens: a live control bound to the example, with `@min`/`@max`/`@step` driving it. Use it for any number-valued argument. For a string, **UsageString**; a boolean, **UsageBool**; for something with no manipulable value, **UsageArgument**.

## The contract

```
@mode? 'doc' | 'prop'
@name?, @description?, @defaultValue?, @required?, @optional?, @hideControls?
@value?: number | null
@min?, @max?, @step?
@onInput?(value: number | null)
```

**`@value` and `@onInput` are `number | null`, not `number`.** A knob must be able to express "not set" — an argument left off entirely — and `null` is the honest representation. `NaN` and the empty string are both worse: the first renders as visible garbage, the second forces every consumer to parse.

**`@min`/`@max`/`@step` are what make the control usable.** With bounds, a numeric knob can be a **Slider** — drag it and watch the example respond, which is the single most useful interaction on a documentation page. Without them, it falls back to a typed field. So supplying bounds is not decoration; it changes the affordance.

**`@mode` is the lens.** The `<:api>` block is authored once and rendered twice — property list (`prop`) and API table (`doc`).

## Prior art

**ember-freestyle's `Freestyle::Usage::Number`** is the upstream; the invocation surface is verbatim.

**Storybook's `number` and `range` controls** are the analogue, and — as with **UsageString**'s options — Storybook makes them two separate declarations (`control: { type: 'range', min, max, step }`), where here supplying the bounds is what selects the presentation. Fewer ways for the control type and its bounds to disagree.

The Pretui port's improvement, consistent across the family: **the control is the kit's own Slider or Input**, so the documentation surface dogfoods the components it documents.

Where it is behind Storybook: no unit annotation (a number that means pixels, seconds or a ratio looks identical), and no `Intl` formatting — a numeric knob shows a bare number, which is the same gap **NumberInput** has in the controls territory.

## Accessibility

No pattern of its own; it renders a **Slider** or an **Input** plus a table row, and inherits their contracts.

Gaps, and two are inherited and consequential in this context:

- **Slider's `aria-label` defaults to the literal `'Slider'`** and it accepts no `@controlId`, so **Field**-style `<label for>` wiring is not available to it at all. A property list of numeric knobs can therefore end up as several controls all announced "Slider". This is an API hole in **Slider** that shows up first here.
- **Slider sets no `aria-valuetext`**, so a knob announces "8" where "8 pixels" is meant — and a usage page is precisely where the unit matters, because the reader is learning what the argument does.
- **Slider styles only `::-webkit-slider-thumb`**, so in Firefox the thumb falls back to the UA default. On a documentation page that is visible on every numeric knob.
- **Changing a knob re-renders the example silently** — no live region, no confirmation.
- **`@required` must reach the accessible name** in the docs lens rather than only rendering an asterisk.
- **`null` versus `0`** is not distinguishable in the control's announcement; an unset numeric argument and one explicitly set to zero read the same.

## Theming

**Slider**'s tokens (`--primary` for the filled track, `--line-strong` for the remainder and the thumb hairline, `--card` for the thumb, `--shadow-ink-mid`, `--font-mono` and `--ink-3` for tick labels) or **Input**'s, plus **Table**'s for the doc row and the property rail's label voice.

Nothing of its own. Check Slider's thumb against `--line-strong` per season — a property list shows sliders at several positions at once, and a thumb that disappears at either end of the track makes the knob unreadable exactly where the bounds are being demonstrated.
