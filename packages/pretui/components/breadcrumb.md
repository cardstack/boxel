## What it is

The trail showing where you are in a hierarchy, with each ancestor a link and the current location in bold. Use it above a **Toolbar** on any record or view that sits inside a structure. It is _location_, not navigation history — a breadcrumb that reflects where the user came from rather than where they are is the classic misuse. If you are showing steps through a process, use **StepList**; if you are showing a list of pages, **Pagination**.

## The contract

```
@items: { label: string; href?: string }[]                 (required)
@onSelect: (item, event: MouseEvent) => void                (optional)
Element: HTMLElement (a <nav> around an <ol>, one <li> per item)
```

`@items` is generic: an item may carry fields of its own beside `label` and `href`, and `@onSelect` is handed the item as given, so a caller can keep whatever it needs to go back to that place on the item itself.

`@onSelect` runs on a plain primary click of a linked crumb. The link still follows its `href` unless the handler calls `event.preventDefault()`, so a caller that decides for itself how to get there (going back through the browser's history, say, rather than loading the address) takes the click over. A Cmd/Ctrl-, Shift- or Alt-click, or any other button, never reaches `@onSelect`: the crumb stays a real link that opens in a new tab or window, or can be copied, whatever the caller does with a plain click.

Three render branches per item, in priority order: **the last item is always `<b aria-current="page">`** regardless of whether it has an `href`; otherwise an item with `href` is an `<a>`; otherwise a plain `<span>`.

That last-item rule is the whole opinion. The current location is not a link even if you gave it one, because linking to where you already are is a dead affordance — and making it structurally impossible means no call site has to remember. The `<span>` branch exists for intermediate ancestors that are real but unreachable (a folder you cannot open, a realm you cannot read), which is a genuine Boxel case.

Each item is an `<li>` carrying `data-test-pretui-breadcrumb-item` with its index. Separators are `/` characters at the start of every item but the first, styled `--subtle-foreground`.

## Prior art

**APG's Breadcrumb pattern is three bullets total**, and it is worth knowing exactly what it does and does not require: contained in a **navigation landmark**; that landmark labeled; and `aria-current="page"` on the link to the current page. **`<ol>` is not required** — the APG example uses one, the normative text never mentions it — and the keyboard interaction section reads "Not applicable".

**Web Awesome `wa-breadcrumb`** takes only a `label` prop, renders `<nav aria-label>`, and on `slotchange` **auto-applies `aria-current="page"` to the last item and strips it from the rest**. **React Aria `useBreadcrumbs`** returns only `navProps` with a localized default label and sets no role; `useBreadcrumbItem` treats the current item as **disabled** (it delegates to `useLink` with `isDisabled: isDisabled || isCurrent`) and defaults `aria-current` to `'page'`. **shadcn** ships styled `<nav>` + `<ol>` markup with `aria-current="page"` and `aria-hidden` separators.

Pretui's data API (`@items` array) is closer to Ark than to the children-based kits, and it makes a breadcrumb one line derived from a model. The last-item-is-not-a-link rule matches React Aria's instinct exactly, arrived at structurally rather than through a disabled state.

Where it is behind: no overflow collapsing. Web Awesome and SLDS both collapse long trails into a `…` menu; here a long trail wraps onto more lines instead, and a label longer than a line breaks within itself, so nothing runs off the edge, but a deep hierarchy costs vertical space. A separator wraps with the crumb after it, so a wrapped line starts with one and never ends with one.

## Accessibility

Governing pattern: APG **Breadcrumb**. All three bullets are met.

- **Navigation landmark: yes.** The root is a `<nav aria-label="Breadcrumb">`, correctly labeled and correctly distinguished from other navs.
- **Keyboard: nothing to do**, and correctly nothing is done — links are ordinary tab stops.
- **`aria-current="page"`: yes.** The current item is a `<b aria-current="page">`, so assistive tech announces it as the current page; the bold weight on its own is visual only. It sits on the one branch that renders the last item, so every trail marks exactly one crumb as current, with or without an `href` — the same result Web Awesome reaches by applying it to the last item automatically. APG puts the attribute on a link to the current page; here the current item is never a link (above), and `aria-current` is a global state, valid on a non-link element.
- **List semantics: yes.** The crumbs are an `<ol>`, one `<li>` each, so a screen reader announces how many there are — useful context in a deep hierarchy, and what every reference implementation does, though APG does not require it.
- **Links are underlined at rest**, so a link and the current item differ by more than ink and weight (WCAG **1.4.1 Use of Color**); hover thickens the underline.
- **Reflow: met.** The trail wraps and long labels break, so at 320px it needs no horizontal scrolling (WCAG **1.4.10 Reflow**).

The separators are hidden from assistive tech: each `/` is `aria-hidden="true"`, so a three-level trail is read as its three crumbs, not as "Realm slash Projects slash Q3 Report" — the treatment shadcn and Web Awesome use.

Further gaps:

- **The `<b>` element carries no heading or landmark role**, so the current location is not reachable except by reading the nav.
- Target size: link text at 12px with a gap of about 7px is well below WCAG 2.5.8's 24×24 minimum on the vertical axis. Breadcrumbs are conventionally exempt in practice, not in the spec.

## Theming

`--muted-foreground` (trail ink and links), `--foreground` (current item), `--subtle-foreground` (separators), `--boxel-font-size-xs` (the trail's size), `--boxel-sp-2xs` (the gap between items on a line), `--boxel-sp-4xs` (the gap between wrapped lines). The `500` weight on the current item, the links' underline and its 2px offset are fixed.

There is no surface, no border and no padding — a Breadcrumb inherits whatever it sits on, which is why it composes above a **Toolbar** without a seam. A theme should keep `--muted-foreground` and `--foreground` separable: the links' underline marks them, and ink and weight set the current item apart.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
