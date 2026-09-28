## What it is

The trail showing where you are in a hierarchy, with each ancestor a link and the current location in bold. Use it above a **Toolbar** on any record or view that sits inside a structure. It is _location_, not navigation history — a breadcrumb that reflects where the user came from rather than where they are is the classic misuse. If you are showing steps through a process, use **StepList**; if you are showing a list of pages, **Pagination**.

## The contract

```
@items: { label: string; href?: string }[]   (required)
Element: HTMLElement (a <nav>)
```

One arg. Three render branches per item, in priority order: **the last item is always `<b>`** regardless of whether it has an `href`; otherwise an item with `href` is an `<a>`; otherwise a plain `<span>`.

That last-item rule is the whole opinion. The current location is not a link even if you gave it one, because linking to where you already are is a dead affordance — and making it structurally impossible means no call site has to remember. The `<span>` branch exists for intermediate ancestors that are real but unreachable (a folder you cannot open, a realm you cannot read), which is a genuine Boxel case.

Separators are `/` characters rendered between items, styled `--ink-3`.

## Prior art

**APG's Breadcrumb pattern is three bullets total**, and it is worth knowing exactly what it does and does not require: contained in a **navigation landmark**; that landmark labelled; and `aria-current="page"` on the link to the current page. **`<ol>` is not required** — the APG example uses one, the normative text never mentions it — and the keyboard interaction section reads "Not applicable".

**Web Awesome `wa-breadcrumb`** takes only a `label` prop, renders `<nav aria-label>`, and on `slotchange` **auto-applies `aria-current="page"` to the last item and strips it from the rest**. **React Aria `useBreadcrumbs`** returns only `navProps` with a localized default label and sets no role; `useBreadcrumbItem` treats the current item as **disabled** (it delegates to `useLink` with `isDisabled: isDisabled || isCurrent`) and defaults `aria-current` to `'page'`. **shadcn** ships styled `<nav>` + `<ol>` markup with `aria-current="page"` and `aria-hidden` separators.

Pretui's data API (`@items` array) is closer to Ark than to the children-based kits, and it makes a breadcrumb one line derived from a model. The last-item-is-not-a-link rule matches React Aria's instinct exactly, arrived at structurally rather than through a disabled state.

Where it is behind: no overflow handling. Web Awesome and SLDS both collapse long trails into a `…` menu; here a deep hierarchy simply runs off the edge, and `flex` with no `wrap` and no `overflow` means it will either overflow its container or squash. That is the most visible practical gap.

## Accessibility

Governing pattern: APG **Breadcrumb**. Two of three bullets are met.

- **Navigation landmark: yes.** The root is a `<nav aria-label="Breadcrumb">`, correctly labelled and correctly distinguished from other navs.
- **Keyboard: nothing to do**, and correctly nothing is done — links are ordinary tab stops.
- **`aria-current="page"`: missing.** The current item is a `<b>`, which conveys emphasis visually and nothing semantically. This is the one property the pattern requires and it is absent. Web Awesome applies it automatically; React Aria defaults it. One attribute on the last branch closes it.

Further gaps:

- **The separators are real text content.** `<span class='sep'>/</span>` is announced by screen readers, so a three-level trail reads "Realm slash Projects slash Q3 Report". Every reference implementation marks separators `aria-hidden="true"` (shadcn, Web Awesome) or renders them as CSS `::before` content. This is the second-clearest fix.
- **No list semantics.** APG does not require `<ol>`, so this is not a failure — but a list would let a screen reader announce "3 items", which is useful context in a deep hierarchy. Every reference implementation uses one.
- **The `<b>` element carries no heading or landmark role**, so the current location is not reachable except by reading the nav.
- **Links have `text-decoration: none` at rest** and underline only on hover. Since they sit in `--muted-foreground` against the page and the current item is `--foreground`, **colour and weight are the only resting distinction between a link and non-link item** — a WCAG **1.4.1 Use of Colour** concern for the link/non-link distinction specifically. Underlining at rest, or accepting that breadcrumbs are a known convention, are the two defensible answers.
- **No overflow behaviour** (above) is an accessibility issue as well as a visual one: a trail that overflows horizontally with no scroll container fails WCAG **1.4.10 Reflow** at 320px.
- Target size: link text at 12px with a 6px gap is well below WCAG 2.5.8's 24×24 minimum on the vertical axis. Breadcrumbs are conventionally exempt in practice, not in the spec.

## Theming

`--muted-foreground` (trail ink and links), `--foreground` (current item), `--ink-3` (separators), `--text-ui` (12px). The 6px gap, `500` weight on the current item and the 2px underline offset are fixed.

There is no surface, no border and no padding — a Breadcrumb inherits whatever it sits on, which is why it composes above a **Toolbar** without a seam. A season must keep `--muted-foreground` and `--foreground` separable, since the current item is distinguished from its ancestors by ink and weight alone.
