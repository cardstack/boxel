## What it is

A selected record as a removable capsule: icon or initials **Avatar**, label, and an individually-named remove button. Use it wherever a record-valued field shows its current value — inside **Lookup**, in a filter bar, beside a form field, in a **RecordDetail** row. If the value is a category rather than a record, **Chip**. If you need the full identity row with a subtitle, **EntityDisplay**. If the reference is gone, **BrokenLink**.

## The contract

```
@record: PickerRecord   (required)
@removable? (default true), @disabled?
@onRemove?(record: PickerRecord)
Element: HTMLSpanElement
```

`@disabled` suppresses the remove button *and* dims the capsule — one arg, both consequences, so a disabled pill cannot be half-interactive.

**It is built as its own primitive rather than buried inside Lookup**, and the reason is stated in the source: every record-valued form control needs it. **MultiSelect** already set the precedent of a purpose-built removable chip.

**Why it is not `Chip`**, which is the kit's capsule: Chip is an 18px status marker with no room for a 16px hit target. A remove button inside an 18px pill is below any usable target size. So RecordPill carries the **FilterChips** capsule dress at **24px** with a real remove button. That is a considered fork rather than duplication, and it is the right call — the alternative was a Chip with a variant that changes its height and adds a button, which is two components wearing one name.

## Prior art

**SLDS's `pill`** is the direct ancestor — icon, label, remove — and is the component this whole record family descends from. **React Spectrum's `TagGroup`/`Tag`** is the modern equivalent, with `onRemove`, keyboard removal via the Delete key, and roving tabindex across the group. **Web Awesome `wa-tag`** has `with-remove`. **Radix** has none.

Where Pretui matches the field: an individually-named remove button, which is the one thing that makes a row of pills usable — "Remove Acme Corp", not eight buttons all called "Remove".

Where it is behind React Spectrum, and it is the notable gap: **there is no group.** Spectrum's `TagGroup` gives a set of pills a roving tabindex (one tab stop for the whole group), arrow navigation between them, and **Delete/Backspace to remove the focused pill** — the keyboard affordance people actually use. Pretui has the pill and not the group, so eight selected records are eight pills plus eight remove buttons, all in the tab sequence, with no keyboard shortcut for removal. Whatever contains the pills (**Lookup**, **MultiSelect**) owns that problem and neither solves it.

Also absent: no size axis, no click-to-open (a pill representing a record you cannot navigate to is a dead end), and no overflow/"+3 more" behaviour.

## Accessibility

No APG pattern for a pill; the applicable model for a *set* of them is Spectrum's grid-based `TagGroup`.

What is right:

- **The remove button is individually named** with the record's label, so a screen-reader user knows what they are removing.
- **`@disabled` removes the button rather than disabling it**, so there is no unreachable dead control in the tab order.
- **The avatar or icon is `aria-hidden`** (RecordFace wraps it), so Avatar's initials never announce as loose letters; the pill's text is its name.

Gaps:

- **No group semantics** (above). This is the substantive one: a row of pills is a set, and nothing says so — no count, no `role="list"`, no roving focus, no Delete-key removal.
- **The pill itself is not focusable**, only its remove button. So keyboard users tab *past* the label to reach the remove control, and there is no way to focus a pill to inspect or open it.
- **Removal is not announced.** The pill disappears and nothing says "Acme Corp removed" — except inside **Lookup**, which has its own live region doing exactly that. A bare RecordPill outside Lookup announces nothing, which is worth knowing before using it in a filter bar.
- **Focus after removal is unmanaged.** Removing the last pill in a row leaves focus on a detached node; focus should move to the next pill or to the field. This is the classic removable-tag bug and every implementation has to solve it explicitly.
- **The label may truncate** with no full-text fallback, though the accessible name carries the full string.
- Target size: the remove button is a 16px hit target inside a 24px capsule — below WCAG **2.5.8**'s 24×24 minimum, and the reason the pill was sized up from Chip's 18px in the first place. Worth noting the constraint was acknowledged and only partly resolved.

## Theming

The **FilterChips** capsule dress at 24px: the per-record hue derivation (`--pretui-chip-mix`, `--pretui-ink-mix` mixed against `--card`, hairline against `--border`), `--foreground`, `--muted-foreground`, `--hover` for the remove button, and **Avatar**'s hash palette for the initials fallback.

Because the dress is shared with FilterChips, a season retuning chip tints moves record pills too — intended, and worth knowing if you were tuning filter chips and forgot they also appear inside every Lookup. The 24px height is fixed; a season cannot make pills denser without breaking the remove button's already-marginal target size.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
