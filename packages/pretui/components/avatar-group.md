## What it is

A row of overlapping **Avatar**s, each ringed in the card colour so neighbours stay separate. Use it where several people share a thing and you need to show that at a glance without a list — reviewers on a document, attendees, watchers, presence in a room. If the people need to be individually identifiable or actionable, use a real list. If there are more than about five, cap the row and add a count.

## The contract

```
<:default>   — the Avatars
Element: HTMLSpanElement
```

**No args at all.** It is a layout wrapper: an `inline-flex` with a `-6px` left margin on every child Avatar except the first, and a 2px `--card` ring replacing each Avatar's normal hairline. That ring is what makes the overlap legible — without it, two adjacent avatars of similar hue merge into a blob.

The styling reaches its children through `:deep(.pretui-avatar)`, which is a deliberate, narrow use of the escape hatch: the component must restyle content it did not render. The consequence is that **it only works on Pretui `Avatar`s** — an arbitrary circle yielded in will not overlap or get the ring.

**Overflow is entirely yours.** There is no overflow arg, no `+3` chip, no truncation. A group of forty avatars renders forty avatars. In practice you slice the array at the call site and put a **Chip** after the group.

## Prior art

**Web Awesome** has no avatar group. **Radix** has none. **React Spectrum `AvatarGroup`** takes `label`, `size` and `orientation`, and — crucially — is a **labelled group** with real semantics. **shadcn** documents an avatar-stack recipe with a `-space-x-2` utility and nothing else. **Material** and **Ant** both ship `max`/`maxCount` with an overflow avatar.

So the field splits into "a CSS trick" (shadcn, and effectively this) and "a semantic group with overflow handling" (Spectrum, Ant). Pretui is on the CSS-trick side, and the honest reading is that this is the thinnest component in the ink territory relative to its prior art.

What it does get right: **the ring is `--card`, not white.** That is the difference between a group that works on a panel and one that shows white halos on every dark or tinted surface, and it is the single most common bug in hand-rolled avatar stacks. Because the ring is a token, the group composes onto any Pretui surface correctly.

What it is missing, concretely: `@max` with an overflow indicator (the most-requested feature and present in every mature implementation), a group label, `@size` currying so children do not each need their own, and reverse stacking order (the first avatar sits on top here, so a long row's _last_ avatar is the least visible — most implementations invert the `z-index` so the leftmost is on top, which this achieves by DOM order rather than deliberately).

## Accessibility

No APG pattern.

This is where the gap versus React Spectrum matters most, and it is worth being direct:

- **The group has no accessible name and no group semantics.** No `role="group"`, no `aria-label`, no list markup. A screen-reader user encounters a run of avatars with no indication that they belong together, and no count. Spectrum's `AvatarGroup label` exists precisely for this — "Reviewers, 4 people". Adding `role="group"` plus an `@label` arg would be the single highest-value change to this component.
- **Each avatar announces individually**, and inherits **Avatar**'s own gap: an initials-only Avatar has no accessible name at all (the initials are announced as letters, and the full name lives in an unreliable `title`). So a group of five initials-only avatars announces as "AL JP MK RS TW" — ten letters, no names. In a group this compounds from a minor issue into an unusable one.
- **No count is available anywhere.** Sighted users can see five circles; a screen-reader user gets five unlabelled fragments and no total. Since overflow is the caller's job, the "+3" that would carry it is not part of the component either.
- **Overlap and target size**: if the avatars are interactive (wrapped in links at the call site), the `-6px` overlap means each target is partially occluded by its neighbour, and the leftmost 6px of every avatar after the first is unclickable. That is a **WCAG 2.5.8 Target Size** concern for interactive groups. Non-interactive groups are unaffected.
- **The ring is decorative** and contributes nothing to the accessibility tree — correct.

Practical guidance: wrap the group in a labelled `role="group"` or a `<ul>` at the call site, give each Avatar an `aria-label`, and render a visible count.

## Theming

`--card` (the 2px separator ring). That is the only token this component consumes directly; everything else belongs to the **Avatar**s inside it.

The `-6px` overlap and the 2px ring width are fixed, so a season cannot make the stack tighter or looser. The ring being `--card` means a group placed on `--canvas` or `--inset` — an **EmptyState**, a table's header band, a striped row — will show rings in the wrong colour. That is the one placement trap: the component assumes it sits on a card surface, and there is no token to tell it otherwise.
