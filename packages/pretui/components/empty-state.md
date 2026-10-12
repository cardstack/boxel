## What it is

What a region shows when it has nothing to show: a title, an optional message, and an optional action. Reach for it in place of a blank area whenever a list, table, search result or panel body is legitimately empty. If the region is _loading_ rather than empty, use **Skeleton** or **LoadingState** — an empty state shown during a fetch is a lie. If the emptiness is an error, use **Alert**. If a single reference is missing, **BrokenLink**.

## The contract

```
@title: string   (required)
@message?, @texture? (default true), @separator? (default 'or'), @size? (default 'm')
<:default>   — the message with markup in it; wins over @message
<:action>  <:altAction>
Element: HTMLDivElement
```

**`@title` is required and `@message` is not.** That ordering is the opinion: an empty state must always name what is absent, and may explain. A component that let you render a lone paragraph would produce the vague "Nothing here yet" that empty states are notorious for.

**This is the one place texture lives.** The kit's Law 6 says decoration is confined, and an EmptyState is where it is allowed: a radial gradient at 8% `--primary` centred slightly above the middle. `@texture={{false}}` turns it off for dense contexts. Everything else in the kit is flat, and that is what makes this read as a deliberate pause rather than as ornament.

**The message takes markup through `<:default>`.** `@message` is plain text. When the message needs a **Token**, a link or emphasis, pass the message as the block; it renders in the same place with the same type, colour and measure. The `@message` arg renders in a `<p>`; the block renders in a `<div>`, because the caller's markup may contain block elements. A block wins over its arg, as on **Notification**, **AlertDialog** and **Card**: if both are given, the block renders and `@message` does not.

**`@size`** takes the house scale (`xs | s | m | l | xl` and the `sm` / `md` / `lg` / `small` / `medium` / `large` / `default` aliases) and paints two steps. `s` is the compact well for an empty note inside a card section: `--boxel-sp` padding on every side and the title at `--boxel-font-size`. `m`, the default, is sized for a page section. `xs` lands on `s`, and `l` / `xl` on `m`. The resolved step lands as `data-size`, `'s'` or `'m'`, on every render, the default included.

`max-width: 34ch` on the message is the measure at which a centred paragraph stays scannable — wider and the eye loses the line, and centred text is much less forgiving of long measures than left-aligned.

The title is set in `--font-serif`. That is the only serif in the control and structure territories, and it is the signal that this is a moment of address rather than a label.

## Prior art

**React Spectrum `IllustratedMessage`** is the closest match — an illustration slot, `Heading`, `Content`, and it is what Spectrum's tables render via `renderEmptyState`. **shadcn** ships no empty state; it is a documentation recipe. **Web Awesome** has none. **SLDS** has an `illustration` blueprint with a fixed set of SVGs.

Pretui differs on the illustration question, and it is the interesting one: Spectrum and SLDS both centre the pattern on an **illustration**, which means every product must commission or choose art, and most ship the same three stock SVGs everywhere. Pretui substitutes a **generated texture** — a tinted radial that picks up the theme's `--primary` — so an empty state looks intentional and on-brand with zero assets. That is a genuinely better default for a system where cards are authored quickly.

The other improvement: **`@title` being required**. Spectrum's `Heading` is optional.

Where it is behind: no illustration slot and no `<:icon>`, and only two sizes (a compact well and the page-section default) where Spectrum's `IllustratedMessage` scales its illustration and heading together.

## Accessibility

No APG pattern. Relevant criteria: WCAG **1.3.1**, **2.4.6 Headings and Labels**, and the live-region rules if the state appears dynamically.

Gaps, and the first two are the real ones:

- **The title is a `<div>`, not a heading.** `.pretui-empty-title` is styled to look like one (serif, `--text-heading`) but carries no `<h*>` and no `role="heading"`, so it does not appear in a screen reader's heading list and does not structure the region. Given that **Panel** and **Toolbar** in this same territory hard-code `<h2>`, the inconsistency is striking — and the right answer for all three is the same authorable `@headingLevel` that **ErrorSummary** already has.
- **Nothing announces the transition to empty.** When a filter reduces a table to nothing, the empty state replaces the rows silently. A `role="status"` on the container would announce "No matching records" — and would have to exist before the change to work, which is the usual live-region caveat. This is the single most useful addition.
- **The texture layer has no `aria-hidden`**, though it is an empty `<div>` with no content, so nothing is announced — correct by accident rather than by declaration.
- **The empty state does not replace a table's semantics.** If you render it _instead of_ a `<tbody>`, screen-reader users lose the table's structure and get a bare region. React Spectrum's `renderEmptyState` renders inside the grid for exactly this reason. Placement is the caller's responsibility here.
- `@message` is limited to `34ch` and centred; long messages will be several short centred lines, which is harder to read for users with dyslexia (WCAG **1.4.8**, AAA).
- The action in `<:action>` is an ordinary tab stop, which is right — an empty state should not trap or auto-focus.

## Theming

`--canvas` with its paired `--foreground` (the surface and the ink for the title, message and separator — note it is **not** `--card`, so an EmptyState reads as a recess inside a Panel rather than as another card), `--border` (the separator rules), `--primary` (the texture tint, at 8%), `--font-serif`, `--boxel-heading-font-size` and `--boxel-heading-font-weight` (title), `--boxel-font-size-xs` (message), `--boxel-font-size-2xs` (separator), `--radius`, and `--boxel-sp-2xs/xs/sm/lg/3xl` for the gaps and padding. At `@size='s'` the padding is `--boxel-sp` and the title reads `--boxel-font-size`, so `--boxel-sp-lg/3xl` padding and `--boxel-heading-font-size` no longer apply.

The message and separator are set in `--foreground`, at the smaller size, because the contract guarantees `--muted-foreground` only on `--background`, `--card` and `--muted`, not on the neutral `--canvas`.

The title uses the theme's `--font-serif` (IBM Plex Serif by default), which is used almost nowhere else in the kit, so it is the component's one moment of typographic voice. A theme must also keep `--canvas` distinguishable from `--card`, or the empty state stops reading as a recess and the whole effect flattens.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

shadcn/Ant `Empty` is this component under that name (**Empty**). Page-level 404/success
is **Result**. A missing linked card is **BrokenLink**.
