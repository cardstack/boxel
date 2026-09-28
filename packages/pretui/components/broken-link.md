## What it is

An honest "this reference is gone". When a card links to another card that has been deleted, moved, or is not readable, something has to render — and the wrong answer is a blank, a raw id, or a link that goes nowhere. This is a Boxel-specific obligation rather than a general UI pattern, which is why no other kit ships an equivalent. Use it anywhere a `linksTo` resolves to nothing. If the reference is present but still loading, use **Skeleton** or **Spinner**. If the _whole_ region is empty rather than one reference, use **EmptyState**.

## The contract

```
@label? (default 'missing card')
@refId?
Element: HTMLSpanElement
```

Two args and no actions. It is a marker, not an affordance — there is nothing to click, nothing to retry, nothing to dismiss.

**`@refId` is optional and shown at 70% opacity after the label.** That is the whole recovery story: a developer or an author who sees the id can go find out what happened; an end user sees a quiet grey chip and moves on. Showing the id by default would be noise; hiding it entirely would make the failure undebuggable.

The visual vocabulary is chosen to read as _absence_ rather than _error_: `--ink-3` mono type, a dashed outline drawn with `outline` + `outline-offset: -1px` (so it does not affect layout the way a border would), a strike-through at 50% alpha, and an `--inset` fill. It deliberately does **not** use `--destructive` — a missing reference is a fact about the data, not something the user did wrong, and painting it red trains people to panic about a normal state.

## Prior art

There is no direct prior art, and that is worth saying plainly: Radix, React Spectrum, Web Awesome and shadcn all assume references resolve, because they are component kits for applications that own their data. A realm-based system where a card can link to a card in another realm that may be deleted or unreadable has a failure mode those kits do not.

The nearest analogues are editor conventions rather than component APIs — Notion's "Deleted page" inline mention, Figma's missing-component placeholder, and a broken image's `alt` fallback. All three share the same instinct as this component: keep the slot occupied, name the absence, stay visually quiet.

Where Pretui's version is better than the ad-hoc thing most codebases write: it is **one component with a stable look**, so every broken reference in every card reads identically, and a reviewer scanning a page can tell missing-data from styled-error at a glance. The improvement is consistency, not cleverness.

The obvious gap versus what it could be: **no retry, no "why", no distinction between deleted, unauthorised and still-loading.** Those are three different situations with three different user responses, and the component flattens them to one. `@reason` would be a natural addition.

## Accessibility

No pattern governs it; the relevant criteria are WCAG **1.3.1**, **1.4.1 Use of Colour** and **4.1.2**.

What is right: the SVG is `aria-hidden`, so the broken-link glyph does not pollute the announced text, and the label text is real content rather than a background image.

Gaps:

- **`title='This reference is gone'` is the only explanation**, and `title` is unreliable: it is not shown on touch, not reachable by keyboard, and announced inconsistently. Worse, on a non-interactive `<span>` many screen readers ignore it entirely — so for most assistive-tech users the element announces as "missing card" with no indication of what that means. Making that sentence visible text, or wiring it via `aria-describedby`, would fix it.
- **Strike-through is decorative styling, not semantic.** `text-decoration: line-through` on a `<span>` conveys nothing to assistive tech. If the strike is meant to say "this used to be a link", `<del>` or `<s>` would carry it — though `<s>` is a stretch here.
- **The state is conveyed visually by colour, dash pattern and strike**, none of which reach assistive tech. The word "missing" in the default label is doing all the semantic work, which is why overriding `@label` with something that omits the word ("Q3 Report") silently removes the only accessible signal that anything is wrong. Prefer labels that keep it.
- **`--ink-3` on `--inset` is the kit's quietest ink on its quietest surface**, and at 11.5px mono it is close to the WCAG **1.4.3** floor. Verify per season; this is the component most likely to fail contrast in a light theme.
- `@refId` at `opacity: 0.7` on top of `--ink-3` compounds that — it is decorative-grade contrast carrying debugging information.
- Nothing is focusable, which is correct: there is nothing to do.

## Theming

`--inset` (fill), `--ink-3` (ink and the 50%-alpha strike), `--line-strong` (the dashed outline), `--font-mono`, `--text-ui-sm`. The 6px radius, 2px/8px padding and 11px glyph are fixed.

Note this component uses **no semantic tone token at all** — no `--destructive`, no `--warning`. That is deliberate (see above) and a season should resist re-pointing it at an error colour. The one thing a season must get right is `--ink-3` against `--inset`: everything here is drawn at the quiet end of the palette, so a season that compresses its greys will render broken links effectively invisible.
