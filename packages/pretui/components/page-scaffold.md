## What it is

The page frame: masthead, subhead, navigation rail, content column, aside rail and footer — each a real HTML landmark.

## The contract

```
@preset?   — boxel-layout preset: 'page' (default) | 'bare' | 'notebook' | 'tools'
@label?    — accessible name for the <main> region
@navLabel? — accessible name for the <nav> rail. Default 'Section navigation'
@asideLabel? — accessible name for the <aside> rail. Default 'Supplementary'
@navWidth?, @asideWidth? — rail widths; any CSS length. Defaults 14rem / 16rem
@maxWidth? — cap on the content measure; overrides the preset's own. Default 72rem
@stickyMasthead? — pin the masthead to the top of the scroll container
@divided?  — hairlines between the bands, as the 'notebook' preset does
@skipLink? — render the skip-to-content link. Default true

<:masthead>   top band, full width
<:subhead>    second band — breadcrumb, filters, a Toolbar
<:navigation> the start rail, a <nav> landmark
<:default>    the content column, a <main> landmark. The ONLY required block
<:aside>      the end rail, an <aside> landmark
<:footer>     bottom band, full width
```

**Regions map to real landmarks** — `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>` — rather than to divs with roles. Only `<main>` is mandatory, and it is the default block, so the simplest use is a scaffold wrapping content.

**A rail that gets no block is not rendered.** There is no empty `<nav>` landmark waiting to be filled, which matters because an empty landmark is worse than none.

**The skip link is on by default.** It is the one affordance a page frame can supply that no component inside it can.

**Rail widths are args rather than tokens** because a documentation page and a tool need different rails, and that is a per-page decision rather than a seasonal one.

## Prior art

The app-shell component in every kit, and the boxel-layout presets this wraps.

Where Pretui is better: the landmarks are the elements rather than roles on divs, the rails are named by default, and the skip link is present unless removed.

Where it is thinner: no responsive rail collapse — a narrow viewport is the caller's to handle — no drawer behaviour for the navigation rail, and no scroll restoration.

## Accessibility

- **Real landmark elements**, which is the difference between a page a screen-reader user can navigate by region and one they have to read linearly.
- **Both rails are named by default**, because an unnamed `<nav>` beside another `<nav>` is indistinguishable in a rotor. The defaults are generic; overriding them is worth it on a page with two navigations.
- **`<main>` takes `@label`**, which matters on any page with more than one scaffold or an embedded one.
- **The skip link is the first thing in the tab order** and is what makes a page with a large masthead and rail usable by keyboard at all.
- **`@stickyMasthead` reduces the usable viewport**, which affects anyone using large text or magnification most — worth checking at 200% zoom.
- **Landmarks are only useful if they are used.** A scaffold whose navigation block contains the page's actions and whose main contains a second navigation has landmarks that lie.

## Theming

`@navWidth`, `@asideWidth` and `@maxWidth` are caller values; `@preset` selects a boxel-layout arrangement; `@divided` draws the band hairlines from the shared `--border` token.

The measure cap is the one worth thinking about seasonally: 72rem is a reading measure, and a season with a larger base size effectively narrows it in characters — which is the right behaviour, and surprising if you expect a fixed pixel width.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
