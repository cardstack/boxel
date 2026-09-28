## What it is

Segmented time entry — the Calendar family's clock. Hours, minutes, optionally seconds, optionally an AM/PM segment, each stepped with the arrow keys.

## The contract

```
@value?, @defaultValue? — wire value: 'HH:MM', or 'HH:MM:SS' with @withSeconds
@withSeconds?
@hourCycle?     — '24' (default) or '12', which adds the AM/PM segment
@disabled?
@label?         — group label announced by assistive tech. Default 'Time'
@now?           — reference time an EMPTY segment steps from on its first arrow press
@onValueChange? — receives the wire string when complete, '' when incomplete
```

**The wire value is 24-hour regardless of `@hourCycle`.** The cycle changes what the reader sees and types; `HH:MM` is what the caller stores either way, so a form is never parsing "3:45 PM".

**`@now` exists because realm code may not read the clock.** Pass the app's own clock to get seed-from-now behaviour on a first arrow press; omit it and each segment seeds from its minimum — 00 / 00 / 00 / AM — which keeps stepping deterministic and testable.

**An incomplete time reports `''`, not a partial string.** A caller never receives `'14:'`.

## Prior art

**`wa-time-input`.**

Where Pretui is better: the injected clock. The upstream seeds from `Date.now()` internally, which makes it untestable without faking time and unusable where reading the clock is forbidden; taking the instant as an argument fixes both, and the deterministic fallback means omitting it still behaves predictably rather than arbitrarily.

Where it is thinner: no timezone handling of any kind — this is a wall-clock time, and a caller that needs an instant has to combine it with a date and a zone — no minute stepping granularity, no range constraint, and no locale-driven segment order.

## Accessibility

- **The segments sit in a named group**, defaulting to "Time", so they announce as one field rather than as two or four loose spinners.
- **Each segment is stepped by the arrow keys**, which is the platform behaviour a reader expects from a time field and the reason a segmented control beats a free-text one here.
- **The AM/PM segment only exists in 12-hour mode**, so a 24-hour field has no dead segment to travel through.
- **Seeding is deterministic without `@now`.** A screen-reader user pressing Up on an empty hour segment gets 00, every time, rather than whatever the clock happened to say.
- **Incomplete state is reported as empty rather than as a partial value**, which means a form's validation never sees a half-typed string it has to interpret.

## Theming

The segment sizing and gaps come from the shared `--pretui-otp-size` and `--pretui-otp-gap` tokens this module defines, over `--pretui-shadow-control` and `--pretui-shadow-inset` for the segment surfaces.

Sharing those tokens with **OtpInput** is deliberate: both are segmented character entry, and a season that tightens one should tighten the other — a time field and a code field that disagree on slot rhythm look like two different products on the same form.
