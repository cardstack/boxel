## What it is

A discrete signal-strength meter: a small run of rising bars, some lit, with a mandatory text label beside them. Use it for a _qualitative level within a known range_ — signal, confidence, priority, capacity, a 1–5 score. It is deliberately **not** a progress indicator: if the value is completion toward a goal, use **ProgressBar** or **ProgressRadial**, which look different on purpose. For an exact number, **Stat** or **Token**.

## The contract

```
@level: number   (required)
@label: string   (required)
@segments? (default 3), @hue?, @heights? (default [6, 10, 14])
```

**Law 4: discrete beats continuous, and segments always ship a text label.** Both halves are enforced by the type — `@label` is required, not optional. A row of three bars conveys "some" but not "two of three"; the label is what makes the value readable, and making it required means no call site can ship a bar cluster with no words. This is the kit's clearest example of an accessibility requirement expressed as an API constraint rather than as documentation.

**Discrete, not continuous.** Three bars at 6/10/14px (written as rem, so they follow the root font size), `@level` of them lit. `@segments` and `@heights` let you make it five bars or flat ones, with `@heights` falling back to its last entry when it runs short, so `@segments={{5}}` with the default three heights gives 6, 10, 14, 14, 14 — probably not what you want. Pass matching arrays.

## Prior art

**No component kit ships this.** Radix, Web Awesome, shadcn and React Spectrum all have `progressbar` and Spectrum has a `Meter` (a bar with `variant` `informative | positive | critical | warning`) — but the _segmented signal-strength_ form is a platform convention (iOS/Android status bars, Wi-Fi indicators) rather than a design-system component.

Where making it one pays off: **the label requirement**. Every ad-hoc signal-strength cluster in every product is three unlabelled divs, and it is the most reliably inaccessible micro-component in the field. Requiring the label at the type level fixes that category of bug by construction.

Where it is thinner than Spectrum's `Meter`: no semantic variants (a meter at 1/5 does not turn red), no `valueLabel`/`formatOptions`, and no continuous mode.

## Accessibility

Governing pattern: APG **Meter** — `role="meter"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and, when the raw number is not human-friendly, `aria-valuetext`, plus a label. Correct for a **static measurement within a known range**; wrong for task progress (that is `progressbar`) and wrong for unbounded quantities.

What is right: `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax` and `aria-label` are all present, and the visible label is required — so unlike most of this kit's small components, a Meter is never anonymous.

- **`role="meter progressbar"`, a fallback role list.** `role="meter"` has uneven support: Firefox does not implement it at all, and a bare `meter` there announces as an unlabelled group, losing the level. The first role an engine understands wins, so meter-aware engines get `meter` and Firefox falls back to `progressbar`, which reads the same `aria-value*` attributes. React Aria's `useMeter` ships the same pair for the same reason.
- **The level is a whole number of bars in `[0, @segments]`.** `@level={{9}} @segments={{3}}` announces 3 and lights three bars; a negative level announces 0 and lights none. A fractional level rounds up, the way a partly reached step lights in the stepped ProgressBar, so `@level={{1.5}}` announces 2 and lights two bars. An unset or non-finite level announces 0 and lights none. The announced value never leaves `aria-valuemin..aria-valuemax`, and it always matches the lit count.
- **`@segments` is a whole number of bars too, 3 when omitted.** `aria-valuemax` is the number of bars drawn. A fractional count rounds up, the way it draws, so `@segments={{2.5}}` draws three bars and reports a max of 3. A negative or non-finite count draws no bars and reports a max of 0, so `aria-valuemax` never reads `NaN` or drops below `aria-valuemin`.

Gaps:

- **No `aria-valuetext`.** "2" is announced where "2 of 3 — Medium" is meant. `@label` already holds the qualitative half; combining them into `valuetext` would make the announcement complete.
- **The visible label is inside the `role="meter"` element, and `aria-label` is set to the same string.** `meter` does not take its name from content, so the `aria-label` wins — but the label text is still a child of the element, and some readers will read it again after the name. Moving the visible label outside the meter element (and pointing `aria-labelledby` at it) would be cleaner than the current duplication.
- **Lit versus unlit is conveyed by fill color alone** — `--border-strong` versus the hue, with identical geometry. That is a **WCAG 1.4.1** risk if the theme's hue and border color are close in luminance; the rising heights differentiate the _bars_, not their states. An unlit outline or a lower opacity would add a second channel.
- **0.25rem-wide bars** are very fine; at high zoom or low vision the lit/unlit distinction may not resolve at all. The label carries the value, which is precisely why Law 4 requires it.

## Theming

`--pretui-meter-hue` (per instance, defaulting to `--primary`), `--border-strong` (unlit bars), `--muted-foreground` (label ink), `--boxel-font-size-xs`.

The 0.25rem bar width, `--boxel-sp-6xs` gap, `--boxel-border-radius-2xs` radius, 0.875rem cluster height and `--boxel-sp-xs` label gap are fixed; bar heights come from `@heights`, an arg rather than a token. `@heights` takes px figures and writes them as rem (÷ 16), so the bars scale with the root font size.

Four tokens, so theming is cheap. The one thing to check per theme is `--border-strong` against `--pretui-meter-hue`: they are the only distinction between lit and unlit, and a dark theme that pushes `--border-strong` toward mid-grey while using a muted hue can make a 1-of-3 meter indistinguishable from a 3-of-3 one.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
