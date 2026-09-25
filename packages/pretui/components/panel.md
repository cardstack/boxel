## What it is

The system signature: a card surface with an optional header, a body, and a hairline-separated action bar (status left, actions right). It is the box everything else sits in. Use it for any bounded region with its own identity — a section of a dashboard, a form group's container, a list with a footer count. If the region needs a title row with actions but no surface, use **Toolbar**. If it collapses, use **Accordion** or **FormSection**. If it floats, **Popover** or **Dialog**.

## The contract

```
@title?, @eyebrow?
<:default>  <:status>  <:actions>
Element: HTMLElement (a <section>)
```

Three decisions.

**The footer renders when either `<:status>` or `<:actions>` is provided.** Status sits left, actions right; an actions-only panel gets a footer with the action cluster alone, and a status-only panel gets the line alone. (An earlier cut gated the footer on `status`, which silently dropped an actions-only panel's buttons; the unit test now holds the either/or.) If you want a title row with actions and no surface, use **Toolbar**.

**`@eyebrow` is the mono uppercase voice**, shared with **Toolbar**, **DataGrid** headers and **FormField** labels. It is how the kit says "this is a category, not a title", and it is the same 11px mono with `--track-eyebrow` letterspacing everywhere.

**The hairline is a `box-shadow`, not a `border`.** `box-shadow: 0 -1px 0 var(--border)` on the footer, and `box-shadow: 0 0 0 1px` for the panel's own edge. Shadows do not participate in layout, so the panel's box metrics are exactly its content plus padding — no `box-sizing` arithmetic, and nested panels do not accumulate border widths. This is a house convention: hairlines ride shadows throughout the kit.

`overflow: hidden` plus `flex-direction: column` means a **DataGrid** or scrolling body clips to the panel's rounded corners without a second wrapper.

## Prior art

**Web Awesome `wa-card`** has `appearance` (accent/filled/outlined/plain), `with-header`/`with-image`/`with-footer` booleans for SSR slot detection, and four slots. **shadcn `Card`** is six components — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` — each a styled div. **React Spectrum** has `View` (a style primitive) and no card per se.

Pretui takes the two-block route rather than shadcn's six-component route, and the trade is the usual one: fewer imports and no way to assemble a header out of order, versus less control. The specific improvement over shadcn is that **the footer's layout is prescribed** — status left, actions right, baseline aligned — so every panel footer in a product agrees. shadcn's `CardFooter` is a flex row and every team invents its own arrangement inside it.

Against Web Awesome: no `appearance` axis. Every Panel is the same filled surface with a hairline. That is a real limitation — there is no quiet, borderless Panel — and the kit currently answers it by not using a Panel.

## Accessibility

No APG pattern. The relevant criteria are WCAG **1.3.1 Info and Relationships** and **2.4.6 Headings and Labels**.

What is right: the root is a `<section>`, and the header is a `<header>` containing an `<h2>`, so the panel has real landmark and heading structure rather than nested `<div>`s.

Gaps, and the heading one matters:

- **The title is hard-coded as `<h2>`.** A card does not know its host's outline — the same panel may be embedded under an `<h1>` on one page and under an `<h3>` on another — so every Panel on a page emits an `h2` regardless of depth, producing skipped and repeated levels. **ErrorSummary** in the forms territory solved exactly this with an authorable `@headingLevel`; Panel should do the same, and this is the single clearest fix.
- **A `<section>` is only a landmark when it has an accessible name**, and nothing wires `@title` to it. There is no `aria-labelledby` pointing at the `<h2>`. So a Panel is either an unnamed `section` (ignored by landmark navigation, which is fine) or, if a season adds a role, an unlabelled one. Wiring the heading id would make panels navigable as regions — worth doing, but note that turning every panel into a landmark is its own kind of noise, so it should probably be opt-in.
- **`@eyebrow` is inside the `<header>` but outside the `<h2>`**, so it is announced as loose text before the heading. Since eyebrows are usually category names ("REVENUE", "STEP 2"), that is arguably correct — but it means the heading alone is often not self-describing.
- **A Panel with no `@title` has no header at all** and is a bare surface; that is correct and there is nothing to announce.
- `overflow: hidden` on the panel can clip a focus ring on an element flush to its edge (WCAG **2.4.11/2.4.13**). Give focusable content a little inset.
- The status/actions footer is a plain `<footer>` with two spans — no `role="toolbar"`, no grouping. For two or three buttons that is right; for more, use **Toolbar** or **ButtonGroup** inside it.

## Theming

`--card` (surface), `--radius-surface`, `--pretui-shadow-card` (the hairline edge), `--border` (the footer rule), `--foreground` (title), `--muted-foreground` (eyebrow and status ink), `--font-mono` + `--text-ui-xs` + `--track-eyebrow` (eyebrow voice), `--text-body`, `--text-ui`, `--track-heading`, `--space-3/4/5`.

A season retuning `--radius-surface` moves Panel, **Dialog** and **Drawer** together, which is intended — those three are the kit's surface vocabulary. `--pretui-shadow-card` is where a season expresses whether panels are outlined or elevated; it defaults to a 1px ring and a season can swap it for a real shadow without touching the component.

## React ecosystem

Closest to Mantine `Paper` / a chromeless Card. Agents who want
header/body/footer composition want the **Card** stub. Agents who want
a Boxel identity tile want **FittedCard**.
