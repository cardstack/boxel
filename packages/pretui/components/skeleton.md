## What it is

A shimmering grey rectangle standing in for content that has not arrived. Use it when you know the _shape_ of what is coming — a title line, three rows, an avatar — because a skeleton that matches the eventual layout prevents the reflow jolt that a spinner does not. If you do not know the shape, use **Spinner** or **LoadingState**. If the content will never arrive, **EmptyState**. If a specific reference is gone, **BrokenLink**.

## The contract

```
@width? (default '100%'), @height? (default '12px')
Element: HTMLSpanElement
```

Two args, both CSS length strings. Compose several to sketch a layout; there is no variant system, no `count`, no `circle` mode.

**Both dimensions go through the kit's CSS guard.** `get style()` builds each declaration with `cssDeclaration`, so a value that fails the allowlist is dropped whole and the stylesheet's own `100%` / `12px` paints instead — the caller loses their override, never the component's rendering.

That guard is the load-bearing part, and it is worth being precise about why the shape alone is not enough. Writing the value into a custom property the component chose (`--_w`, never a caller-supplied property name) stops the value becoming a _property_; it does not stop it becoming a second _declaration_. Unguarded, a `@width` of `0px; background: red` renders as `--_w: 0px; background: red; --_h: 12px` — a live declaration the caller chose. `components/skeleton.test.gts` pins the refusal: that input renders `--_h: 12px`, the width dropped whole and the stylesheet's own `var(--_w, 100%)` painting in its place. A chosen property name plus a validated value is the pattern to copy anywhere caller data reaches CSS; the property name on its own is half of it.

The shimmer is a 200%-wide three-stop `linear-gradient` scrolled by `background-position` — one animation, no pseudo-element, no overlay.

## Prior art

**Web Awesome `wa-skeleton`** takes `effect` (`none | sheen | pulse`) and exposes `--color` and `--sheen-color`; you size it with CSS. **shadcn `Skeleton`** is a `<div>` with `animate-pulse` and a rounded background — you size it with Tailwind classes. **React Spectrum** has no skeleton; it uses `ProgressCircle` and content-shift avoidance instead.

Pretui sits between the two: args rather than classes for size (so a call site does not need a styling system), and no effect axis. The improvement over shadcn is that **sizing is part of the API**, which means a skeleton is one self-describing element rather than an element plus a class soup. The improvement over Web Awesome is smaller — really just that the default 12px height matches the kit's body line box, so a bare `<Skeleton />` already looks like a line of text.

Where it is behind: **no `pulse` alternative and no shape variants.** Web Awesome's `pulse` is the calmer effect and the one to prefer for large areas; a circular skeleton for avatars needs `border-radius` passed through `...attributes`, which works but is undiscoverable. The 6px radius is fixed.

## Accessibility

No APG pattern. Relevant criteria: WCAG **2.2.2 Pause, Stop, Hide**, **4.1.3 Status Messages**, **1.4.1**.

What is right, and it is the important call:

- **`aria-hidden="true"`.** Skeletons are pure decoration and are correctly removed from the accessibility tree. A page of twenty skeletons announces nothing, which is exactly right — the alternative (each one announced as an unlabelled region) is the common mistake.
- **`prefers-reduced-motion: reduce` stops the animation entirely**, leaving a static grey block. That is the correct treatment for a decorative shimmer: unlike **Spinner**, where stopping the motion removes the meaning, a skeleton conveys everything it needs to by being there.

Gaps — all of them at the composition level, which is where they belong:

- **Nothing announces that content is loading, or that it has arrived.** Because the skeletons are `aria-hidden`, a screen-reader user gets _silence_ during the wait and then content appearing with no transition signal. The caller must supply a `role="status"` region — and it must exist in the DOM before the change, which is the usual live-region requirement. This is the single thing to get right when using Skeleton.
- **`aria-busy="true"`** on the region being replaced is the other half, and nothing here sets or suggests it.
- **The animation runs indefinitely.** WCAG 2.2.2 governs motion that starts automatically, lasts more than five seconds and runs in parallel with other content. A slow load with a screenful of skeletons qualifies, and there is no pause control — only the reduced-motion branch, which covers users who have set the preference and no one else.
- **`role="presentation"` semantics via `aria-hidden` also hide any real content** placed inside a Skeleton. Do not nest content in one; it is meant to be empty.
- The grey-on-grey gradient (`--inset` → `--hover` → `--inset`) is intentionally low contrast and carries no information, so **1.4.11** does not apply — but a season that raises the contrast turns skeletons into visual noise.

## Theming

`--inset` (base) and `--hover` (the sheen's bright stop). That is the entire palette, and the two are adjacent by design — the shimmer should be barely perceptible.

The 6px radius, 1.6s duration, `linear` easing and 200% gradient width are fixed. A season cannot slow the shimmer or change its shape; retuning `--inset` and `--hover` closer together or further apart is the only available adjustment, and a season that makes them very different will produce a distractingly strobing page. If a season needs circular skeletons for avatars, pass `style="border-radius: 50%"` through `...attributes` at the call site.

## React ecosystem

Accept `width` / `height` / `radius` / `count`. Law 8: the skeleton
must match the shape of the real content (AspectRatio for media).
