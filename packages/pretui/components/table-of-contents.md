## What it is

The "On this page" sidebar: a list of a document's sections that follows the reader's scroll and marks where they are. Use it beside long-form content — a **Prose** article, a spec, a card with many sections. If the sections are collapsible panels rather than headings, **Accordion** already shows the structure. If the reader is stepping through a process, **StepList**.

## The contract

```
@items: { id, label, level? }[]   (required, in document order)
@label? ('On this page')
@activeId? / @defaultActiveId? / @onActiveChange?(id)
@spy? (default true)
@band? (default 38)
<:item as |item, active|>
Element: HTMLElement (a <nav>)
```

**`@band` is the read band, as a percentage of the viewport.** A heading becomes active once it reaches the top 38% of the scroll container. That is the parameter every scroll-spy has and almost none exposes: too small and headings activate only when they touch the very top, too large and the active item runs ahead of what you are reading. Clamped to 5–90.

**`@items[].id` is a real DOM id** and becomes the link's `href` fragment — so the links work with JavaScript off, and the browser's native fragment navigation does the scrolling.

Two things deliberately dropped from the docs-site originals: **nested collapsible sub-lists** (an accordion in a table of contents hides the thing the reader came for; levels indent instead), and **scroll-into-view on activation** (that is the caller's `scroll-behavior`, not the component's to seize).

## Prior art

**Nextra**, **Docusaurus** and **react-bits**' scroll-spy all take the same approach: bind a `scroll` listener, re-measure every heading's `getBoundingClientRect` on every frame, then cross-fade an active class.

Pretui differs on both halves, and both are improvements:

- **One `IntersectionObserver` instead of a scroll listener.** No per-frame measurement, no layout thrash, and the work happens off the main thread's critical path. The observer is **auto-rooted on the real scroll container** — `scrollParent()` walks up looking for `overflow-y: auto | scroll | overlay` — so a TOC beside a scrolling panel works without the caller wiring a root. In a card system where the scroll container is almost never the viewport, that is the difference between working and not.
- **The active marker travels.** One absolutely-positioned bar whose `top` and `height` follow the active link, measured in a modifier with a `ResizeObserver` for reflow — Law 5's sliding-highlight mechanism, the same idea as **Tabs** and **SegmentedControl**, here vertical. The docs-site originals cross-fade a class, which reads as two separate marks blinking rather than one mark moving.

The source notes this local marker implementation should be replaced by **SlidingHighlight** (`components/sliding-highlight.gts`) once both are on the realm — identical behaviour, only vertical. Worth knowing there are currently two copies of the mechanism.

Where it is behind: **no nested collapse** (deliberate), no "back to top", and no automatic heading extraction — you pass `@items` explicitly, which means a markdown render has to produce them.

## Accessibility

No APG pattern; the governing conventions are the navigation landmark plus `aria-current`, and WCAG **2.4.8 Location** (AAA) is the criterion a TOC exists to satisfy.

What is right, and two details are better than most implementations:

- **`<nav aria-label="On this page">`** — a labelled landmark, so it is distinguishable from the page's other navs.
- **`aria-current="location"`** on the active link. Note the value: `location`, not `page`. That is the correct one — `page` means "this link points at the current page", `location` means "this is where you are within it". Almost every TOC in the wild uses `page` and is subtly wrong.
- **`role="list"` is set explicitly on the `<ol>`, and it is not redundant** — `list-style: none` strips list semantics in Safari/VoiceOver, so an unstyled list silently stops being announced as a list. The source calls this out. This is a real bug that most kits ship.
- **The marker is `aria-hidden`** — it is chrome, and the `aria-current` carries the meaning.
- Links are ordinary tab stops with no roving tabindex, which is correct: a TOC is navigation, not a composite widget.

Gaps:

- **The active change is not announced.** As the reader scrolls, `aria-current` moves silently. That is arguably right (announcing on every scroll would be intolerable), but it means a screen-reader user reading the body has no signal from the TOC at all — they would have to navigate back to it.
- **`@level` indents but carries no semantics.** A level-3 item is visually nested under a level-2 one and is announced as a sibling. `aria-level` on the list items, or real nesting, would convey the document's structure.
- **The link targets must actually exist.** `href="#id"` pointing at a missing element silently does nothing, and nothing validates it.
- **Fragment navigation moves focus** to the target element only if it is focusable or has `tabindex="-1"` — a plain `<h2>` receives *scroll* but not *focus* in several browsers, so a keyboard user clicking a TOC link may find focus still in the TOC. Adding `tabindex="-1"` to headings at the call site is the fix.
- **Target size**: TOC links are small text with tight vertical rhythm, likely below WCAG **2.5.8**'s 24×24 minimum.

## Theming

`--muted-foreground` (resting links), `--foreground` (active link), the marker's fill (the accent bar — a season's `--primary` or the SlidingHighlight tokens), `--border`, `--text-ui-sm`/`--text-ui-md`, and `--_level` (the per-item indent step, set inline from `@level`).

Because the marker is absolutely positioned and measured, a season that changes link line-height or padding gets a correctly-resized marker for free — the `ResizeObserver` handles reflow. A season that hides the marker entirely, however, leaves `aria-current` as the only active signal and ink weight as the only visual one; keep at least one strong visual channel.
