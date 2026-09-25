## What it is

A discrete signal-strength meter: a small run of rising bars, some lit, with a mandatory text label beside them. Use it for a _qualitative level within a known range_ — signal, confidence, priority, capacity, a 1–5 score. It is deliberately **not** a progress indicator: if the value is completion toward a goal, use **ProgressBar** or **ProgressRadial**, which look different on purpose. For an exact number, **Stat** or **Token**.

## The contract

```
@level: number   (required)
@label: string   (required)
@segments? (default 3), @hue?, @heights? (default [6, 10, 14])
```

**Law 4: discrete beats continuous, and segments always ship a text label.** Both halves are enforced by the type — `@label` is required, not optional. A row of three bars conveys "some" but not "two of three"; the label is what makes the value readable, and making it required means no call site can ship a bar cluster with no words. This is the kit's clearest example of an accessibility requirement expressed as an API constraint rather than as documentation.

**Discrete, not continuous.** Three bars at 6/10/14px, `@level` of them lit. `@segments` and `@heights` let you make it five bars or flat ones, with `@heights` falling back to its last entry when it runs short, so `@segments={{5}}` with the default three heights gives 6, 10, 14, 14, 14 — probably not what you want. Pass matching arrays.

## Prior art

**No component kit ships this.** Radix, Web Awesome, shadcn and React Spectrum all have `progressbar` and Spectrum has a `Meter` (a bar with `variant` `informative | positive | critical | warning`) — but the _segmented signal-strength_ form is a platform convention (iOS/Android status bars, Wi-Fi indicators) rather than a design-system component.

Where making it one pays off: **the label requirement**. Every ad-hoc signal-strength cluster in every product is three unlabelled divs, and it is the most reliably inaccessible micro-component in the field. Requiring the label at the type level fixes that category of bug by construction.

Where it is thinner than Spectrum's `Meter`: no semantic variants (a meter at 1/5 does not turn red), no `valueLabel`/`formatOptions`, and no continuous mode.

## Accessibility

Governing pattern: APG **Meter** — `role="meter"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and, when the raw number is not human-friendly, `aria-valuetext`, plus a label. Correct for a **static measurement within a known range**; wrong for task progress (that is `progressbar`) and wrong for unbounded quantities.

What is right: `role="meter"`, `aria-valuenow`, `aria-valuemax` and `aria-label` are all present, and the visible label is required — so unlike most of this kit's small components, a Meter is never anonymous.

Gaps, and the second one is the one to act on:

- **`aria-valuemin` is missing.** Only `valuenow` and `valuemax` are set. Most implementations default it to 0, so this usually works, but the role's contract asks for it.
- **`role="meter"` has poor browser and AT support, and there is no fallback.** This is worth knowing precisely: **Firefox does not support `meter` at all, and Chrome falls back from it automatically; Safari 13+ handles it properly.** React Aria's `useMeter` ships a specific workaround — `role="meter progressbar"`, a fallback role list, so an AT that does not know `meter` treats it as a progress bar rather than as a generic element. Pretui sets `role="meter"` alone, so **in Firefox a Meter announces as an unlabelled group or is skipped entirely.** Adopting the fallback list is a one-token change and is the highest-value fix on this component.
- **No `aria-valuetext`.** "2" is announced where "2 of 3 — Medium" is meant. `@label` already holds the qualitative half; combining them into `valuetext` would make the announcement complete.
- **The visible label is inside the `role="meter"` element, and `aria-label` is set to the same string.** `meter` does not take its name from content, so the `aria-label` wins — but the label text is still a child of the element, and some readers will read it again after the name. Moving the visible label outside the meter element (and pointing `aria-labelledby` at it) would be cleaner than the current duplication.
- **Lit versus unlit is conveyed by fill colour alone** — `--line-strong` versus the hue, with identical geometry. That is a **WCAG 1.4.1** risk if a season's hue and line colour are close in luminance; the rising heights differentiate the _bars_, not their states. An unlit outline or a lower opacity would add a second channel.
- **4px-wide bars** are very fine; at high zoom or low vision the lit/unlit distinction may not resolve at all. The label carries the value, which is precisely why Law 4 requires it.

## Theming

`--pretui-meter-hue` (per instance, defaulting to `--primary`), `--line-strong` (unlit bars), `--muted-foreground` (label ink), `--text-ui-md`.

The 4px bar width, 2px gap, 2px radius, 14px cluster height and 8px label gap are fixed; bar heights come from `@heights`, an arg rather than a token.

Four tokens, so seasoning is cheap. The one thing to check per season is `--line-strong` against `--pretui-meter-hue`: they are the only distinction between lit and unlit, and a dark season that pushes `--line-strong` toward mid-grey while using a muted hue can make a 1-of-3 meter indistinguishable from a 3-of-3 one.
