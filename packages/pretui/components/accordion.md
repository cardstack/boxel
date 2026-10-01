## What it is

A stack of disclosure panels: headers you click to reveal content. Use it when several sections belong together and the user needs only one or two at a time — FAQs, a settings page with grouped options, a long record split into topics. If the sections are peers and only one should ever be visible, use **Tabs**. If the sections are part of a form and their contents can be invalid, use **FormSection**, which knows about issue counts and can open itself when a submit is refused. If it is a single collapse, `<details>` is enough.

## The contract

```
@displayContainer?   — draw the rounded border around the group
<:default as |A|>    — yields { Item }
```

The yielded `A.Item` takes its own open state and click handler, with `<:title>` and `<:content>` blocks.

**State stays with the consumer.** There is no `type='single' | 'multiple'`, no `value`, no `collapsible` policy — each item is individually controlled, so single-open, multi-open and accordion-with-one-always-open are all things you implement in three lines at the call site. That is more work than Radix's `type` prop and it is the honest consequence of the wrap (below).

## Prior art

This is a **thin runtime wrap of boxel-ui's `Accordion` + `AccordionItem`**, and that is the design: foundation rule 1 says the machinery is boxel-ui's and only the cloth changes. What the engine supplies is worth naming — the `grid-template-rows: 0fr → 1fr` height transition (the modern way to animate to auto height without measuring), ARIA region wiring, and content that goes inert when closed.

The wrapper feeds Pretui cloth through the `--boxel-accordion-*` knob channel plus the semantic tokens the engine already reads (`--border`, `--radius`, `--ring`). **No Pretui CSS reaches into boxel-ui markup**, so a boxel-ui upgrade cannot break the dress.

Against the field: **Radix `Accordion`** has `type` (`single`/`multiple`, required), `value`/`defaultValue`/`onValueChange`, `collapsible`, `orientation`, and animates via `--radix-accordion-content-height`. **Web Awesome `wa-accordion`** (experimental) has `mode` (`single | single-collapsible | multiple`), `heading-level` (`1`–`6` or `none`), `icon-placement`, `appearance`, cancelable `wa-expand`/`wa-collapse`, and `expandAll()`/`collapseAll()`. Both own the open-state policy that Pretui delegates.

Where Pretui's approach wins: **there is exactly one disclosure engine in the realm.** Accordion, and anything else that adopts boxel-ui's, share one implementation of the height transition and the inert-when-closed behaviour, rather than each kit component reimplementing it. The `0fr → 1fr` grid trick is also better than Radix's measured-height custom property — no measurement, no reflow, and it interpolates correctly when content changes size mid-transition.

Where it is behind, plainly: **no `mode` policy** (you write it), **no `heading-level`** (Web Awesome's is the right shape and this has no equivalent), no `expandAll`/`collapseAll`, and the whole component is only as good as boxel-ui's ARIA — which the Pretui layer neither adds to nor can fix.

The title voice is deliberately re-cut: body size at weight 600, the **Panel** header voice, not boxel-ui's 700.

## Accessibility

Governing pattern: APG **Accordion**, and it is worth stating the pattern precisely because most people over-implement it.

APG requires: the header title in a `button`, **wrapped in an element with `role="heading"` and an appropriate `aria-level`** (or a native `<h2>`–`<h6>`), with **the button as the only element inside the heading**; `aria-expanded` on the button (required); `aria-controls` pointing at the panel; `aria-disabled` when an open panel cannot be collapsed. `role="region"` on the panel is **optional** and should be avoided past roughly six panels, to prevent landmark proliferation.

The keyboard contract is the entire list: **Enter/Space toggle; Tab and Shift+Tab move through the page tab sequence.** Down/Up/Home/End are **not** in the pattern at any optionality level — they come from APG's *example*, not the spec — and an accordion is explicitly **not a single tab stop**.

What that means here:

- **The ARIA is boxel-ui's, not Pretui's.** `aria-expanded`, `aria-controls` and the region wiring come from the engine. Verify them against your boxel-ui version rather than trusting this page — the Pretui layer adds no ARIA and can fix none.
- **Heading level is the gap to check first.** The pattern requires a real heading wrapping the button, at the right level. Pretui exposes no `@headingLevel`, so whatever boxel-ui emits is what you get, at every depth. This is the same problem **Panel**, **Toolbar** and **EmptyState** have in this territory, and Web Awesome's `heading-level` prop is the fix all four want.
- **Content is inert when closed**, which is right — a collapsed panel's controls must not be reachable by Tab. Note this differs from **FormSection**, which keeps its fields registered so their issues still route.
- **Focus is not managed by the component**, correctly: no roving tabindex, no arrow keys, nothing to get wrong.

## Theming

Consumed directly: `--foreground`, `--text-ui-md`, `--track-ui`.

Remapped into the boxel-ui channel: `--ring` ← `--primary` (the trigger's focus outline — note the engine *does* paint a focus ring, unlike several hand-rolled Pretui controls), `--radius` ← `--radius-surface`, `--boxel-accordion-border` and `--boxel-accordion-item-border` ← `--border`, `--boxel-accordion-item-min-height` ← `--control-h`, `--boxel-accordion-title-font-weight` (600), `--boxel-accordion-trigger-padding-block` ← `--space-3`, `--boxel-accordion-transition` ← `--pretui-dur-snap` / `--pretui-ease-snap`.

A season retunes the accordion entirely through those tokens. The one thing to verify per season is `--ring` against the header background, since the focus indicator here is the engine's and is not the same treatment as the rest of the kit's controls.

## React ecosystem

A stack of **Collapsible**s. Single-panel disclosure is **Collapsible**
itself (Aria `Disclosure`), which animates its own height and keeps its
region mounted. Agent `type=single|multiple` maps to "one open" vs "many
open".
