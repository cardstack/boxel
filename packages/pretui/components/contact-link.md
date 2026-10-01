## What it is

A contact detail rendered as a link you can trust: an email address, a phone number, a handle, a website. The value arrives as whatever the record holds, and the `href` is **built** from it rather than interpolated into it, so there is no path by which a stored string becomes a destination nobody checked.

Use it wherever a record's contact field is shown to a reader. If the value is a link that is already a URL you control, a plain `<a>` is fine; this component earns its place when the value came from data. For a machine-readable value that is not a destination, use **Token**; for a categorical label, **Chip**.

## The contract

```
@channel?  — a channel id ('email' | 'phone' | 'sms' | 'url') or a whole ContactChannel
@value?    — the address, number, handle or URL
@name?     — who or what it belongs to; joins the accessible name
@variant?  — 'chip' (default) | 'row' | 'icon'
@showCta?  — show the verb beside the value in the chip variant
@hue?      — a hue for the Law-2 treatment; defaults to --primary
```

**The href is built, never passed through.** Each channel validates the caller's characters against its own shape first, and the URL channels are re-serialised by the platform's own parser afterwards. An email must match a deliberately conservative shape and is then percent-encoded. A phone number is checked *whole* against digits and the punctuation people write numbers with — that check is what stops an arbitrary string with a few digits in it from being harvested into a plausible `tel:` — and is then rebuilt from digits plus a single leading plus, 3 to 20 of them, so nothing can smuggle a second URI component past the dialler. A handle is matched against a strict shape and appended to its channel's base. Only `http:` and `https:` survive; `javascript:`, `data:`, `vbscript:` and `file:` are refused everywhere, not only on the URL channel.

**The display string and the destination are computed separately, and the display one never builds an href.** A host renders without its scheme and without `www.`, a handle renders with its `@`, an address renders as typed. Conflating the two is how a link ends up going somewhere other than what it says.

**A value that cannot be made safe is still shown.** It renders as a `<span>` carrying the value as text plus a short note saying why it is not a link — never a dead `<a>`, and never nothing, because the reader still wants the information.

**Channels are data.** `CONTACT_CHANNELS` ships the four that are generic enough to belong in a kit; `handleChannel(id, label, base)` builds a profile channel from a base URL, and `@channel` accepts a whole `ContactChannel`, so the set grows without touching this module. Channels resolve by a stable `id`, never by their label — renaming or translating a label must not break a lookup.

**External channels carry `target='_blank'` with `rel='noopener noreferrer'`.** `mailto:`, `tel:` and `sms:` are not external: they hand off to the OS rather than navigating, so a new context would be wrong.

## Prior art

There is no equivalent to compare against, because most kits do not have this component — a contact detail is rendered at the call site as `<a href={{record.website}}>`, and that single line is the whole problem. It trusts a stored string to be a safe destination, it shows the reader one thing while pointing at another, and when the value is unusable it produces a link that goes nowhere. The kit's own `fields-configuration` contact-link is the source this answers to.

So the comparison worth making is against that one line rather than against another kit. What this adds is a validator per channel, a rebuilt rather than forwarded `href`, an honest fallback, and an accessible name that survives a row of four.

Where it is thinner: the validators are conservative rather than RFC-complete, and deliberately so — the cost of a false negative is a value rendered as text with a note, which is recoverable, while the cost of a false positive is an `href` nobody checked. But it means legitimately odd addresses will be refused, and a single-label intranet host (`https://wiki`) is turned away on purpose. There is also no copy affordance and no verification state: the component says whether a value is *shaped* like a destination, never whether it reaches one.

## Accessibility

- **The accessible name is composed, not inherited from the subtree.** A row of four contact links whose names all announce as "Email" looks fine on screen and is unusable with a screen reader, so the name always carries the verb, the value, and the owner when `@name` was supplied — "Email Ada at ada@example.com".
- **The `icon` variant has no visible text at all**, and depends entirely on that composed name. It is the variant to be most careful with: without `@name` it announces only the verb and the value.
- **The mark is `aria-hidden`.** It is inline SVG in `currentColor` rather than a registry lookup, so a channel a caller invents still gets a mark, and none of them contribute to the name.
- **The unresolved state is a `<span>`, not a disabled link.** It is not focusable and announces as text, which is the honest reading: there is nothing to activate.
- **Focus is a 2px `--ring` outline at 2px offset**, and the press is the kit's shared `scale(0.96)`.
- **Contrast is derived rather than verified.** Ink is `color-mix(--foreground 16%, hue)` on `color-mix(hue 12%, --card)` at 11.5px. A pale caller hue produces pale ink on a pale ground; the default `--primary` is the only one the theme guarantees.

## Theming

`--pretui-contact-hue` (the per-instance hue, defaulting to `--primary`), `--card` (the mix base), `--foreground` (mixed into the ink), `--muted-foreground` (the unresolved hue and the note), `--radius`, `--space-2` / `--space-3`, `--text-ui-sm` (11.5px), `--text-ui-md` (13px in the row variant), `--text-ui-xs` (the note), `--weight-medium`, `--ring`, `--pretui-capsule-base` (the horizontal padding multiplier, shared with the other capsules), `--pretui-ease-snap`.

The caller hue reaches CSS through the kit's `cssStyle` guard, so a rejected value drops the declaration and the default stands rather than half a declaration landing in the attribute.

Because every colour mixes against `--card`, a dark season gets correct dark contact chips with no per-season work — but it must pick a `--primary` that survives a 12% mix against a dark `--card`, or the chip and its background converge and only the mark separates them. Retuning `--pretui-capsule-base` restyles this alongside every other capsule in the kit, which is the intent: a contact chip should read as the same family as the chips beside it.
