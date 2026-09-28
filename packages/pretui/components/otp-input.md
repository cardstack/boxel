## What it is

Segmented entry for a one-time code: N single-character slots that behave as one field.

## The contract

```
@length?         — number of character segments. Default 6
@value?, @defaultValue?
@type?           — allowed character class. Default 'numeric'
@masked?         — render entered characters as password dots
@disabled?
@label?          — group label announced by assistive tech. Default 'One-time code'
@onValueChange?  — receives the joined string, dense — no holes — on every edit
```

**The emitted value is always dense.** A click landing past the current value appends at the fill edge rather than leaving a hole, so `@onValueChange` never reports a string with gaps in it and a caller never has to compact one.

**The slots are one field, not N fields.** They share a group label, and navigation keys move focus between them without editing the value.

**`@masked` is a display concern only** — the value the caller receives is unchanged.

## Prior art

**`wa-otp-input`**, with React Spectrum's segmented-input notes as the accessibility reference.

Where Pretui is better: the dense-value guarantee, and the completion announcement below.

Where it is thinner: no paste distribution across slots as a documented behaviour, no per-slot validation feedback, and no resend or expiry affordance — a one-time code usually needs both, and they belong to the surrounding form.

**One known defect, and it is significant.** Every keystroke recreates the segment inputs, so the element the reader typed into is replaced and **focus is lost to the document** rather than walking forward to the next slot. Pinned by a KNOWN GAP test. Entering a code by keyboard requires re-focusing after every character, which is close to unusable with a screen reader. It also masks a second behaviour: where the caret lands after a click past the fill edge is unobservable while focus is being lost.

## Accessibility

- **The slots sit in a `role='group'`** named by `@label`, which is Spectrum's segmented-input pattern — the group carries the meaning, the slots carry the characters.
- **Each slot has its own name**, "Digit 1 of 6", so a reader always knows where they are in the code.
- **Completion is announced once, politely** — "One-time code complete" — through a visually-hidden status region. Completion is otherwise carried by colour alone, and this is the text affordance beside it.
- **The status region says the word once the last slot lands**, and says nothing before that. A region that narrated every character would be unusable.
- **The focus defect above is an accessibility defect first.** Losing focus to the document on every keystroke breaks keyboard entry entirely, and a screen-reader user has no way to recover position without re-navigating.

## Theming

`--pretui-otp-size` (slot dimensions) and `--pretui-otp-gap` (the spacing between them), over the kit's shared `--pretui-shadow-control` and `--pretui-shadow-inset` for the slot surfaces.

Keeping slot size and gap as separate tokens is what lets a season tighten a code field without shrinking the characters — the two read very differently, and a six-slot field at a comfortable size with a tight gap is the arrangement that scans as one value rather than six.
