## What it is

A number that rolls to its new value, digit by digit, with the carry cascading from the units end.

Use it where a value changes and the change is worth noticing — a live total, a counter settling. **Stat** composes it for the headline case.

## The contract

```
@value?      — a number is formatted through Intl; a STRING is used verbatim,
               so a pre-formatted value ('$12,480') rolls too
@locale?, @style?, @currency?, @minimumFractionDigits?, @maximumFractionDigits?,
@useGrouping?, @options?  — the Intl surface, ignored when @value is a string
@duration?   — roll duration in seconds. Default 0.5
@ease?       — CSS timing function. Default a sprung cubic-bezier
@stagger?    — seconds of delay added per digit so the carry cascades. Default 0.03;
               0 rolls every digit together
@staggerFrom? — which end the stagger counts from: 'right' (default — the units
               digit leads, like a carry) | 'left'
@cellHeight? — height of one digit cell, any CSS length. Default 1em
@announce?   — live-region politeness for the sr-only value. Default 'off'
@placeholder? — when the value is missing or not finite. Default '—'

<:before>, <:after> — static content read aloud before and after the value
```

**A string `@value` rolls verbatim.** That is what lets a caller who has already formatted a number — through **FormatNumber**, or from a server — get the roll without the component re-parsing and re-formatting it.

**`@staggerFrom='right'` is the default because that is how a carry works.** The units digit moves first and the tens follow it, which is what makes the roll read as counting rather than as a row of independent wheels.

**`@announce` defaults to `'off'`, and that is a deliberate accessibility decision**, not an oversight — see below.

## Prior art

The odometer/rolling-number component that appears in every dashboard kit.

Where Pretui is better: the string passthrough, the carry direction as a knob, and the live region defaulting to silent.

Where it is thinner: no per-digit colour or emphasis, no roll on mount (the first render is the resting value), and no count-up-from-zero mode.

## Accessibility

- **The rolling digits are `aria-hidden` and the value is mirrored in a live region.** Announcing a wheel of digits mid-roll would be meaningless.
- **That region is `'off'` by default because a value that rolls on every tick would spam a screen reader.** Use `'polite'` only where the value settles at human pace — a total that updates when someone acts, not a metric streaming from a socket.
- **`<:before>` and `<:after>` are read in order around the value**, so "$" and "per month" land in the right places in the announcement rather than being visual decoration.
- **`@placeholder` announces as a dash**, so a missing value is perceivable.
- **Reduced motion should land on the resting value**, which costs nothing — the digits' resting position is the value.

## Theming

`--pretui-odo-cell` (digit cell height, from `@cellHeight`), `--pretui-odo-duration` and `--pretui-odo-ease` (the roll), `--pretui-odo-stagger` and `--pretui-odo-i` (the cascade and each digit's index), `--pretui-odo-start` and `--pretui-odo-rest` (the roll's endpoints).

Everything is derived from args rather than being seasonal, because a roll's timing belongs to the moment rather than to the theme — and the digits inherit their face and colour from context, so an odometer inside a **Stat** looks like that headline rather than like a widget.
