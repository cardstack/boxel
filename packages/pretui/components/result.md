## What it is

The **scene that replaces a pane once an outcome is known**: a submitted order, a missing page, a refused request, a server failure. It gives one heading, one explanation and the ways forward, centred in the space the content would have used.

Reach for a neighbour when the situation is different:

- **EmptyState** is a region that has no data yet and offers two ways to add some. Nothing has happened there.
- **ResultCard** is an agent's output presented as a card.
- **Alert** is an inline message that sits beside content instead of replacing it.
- **Toast** is a transient confirmation.
- **BrokenLink** is a single dead reference, not a whole page.

## The contract

```
@status? ('success' | 'info' | 'warning' | 'danger' | '403' | '404' | '500', or a number; default 'info')
@title?, @description?
@headingLevel? (1–6; default 2)
<:icon>     — replaces the status glyph
<:default>  — detail between the description and the actions
<:extra>    — the ways forward, usually one or two Buttons
Element: HTMLElement (a <section>)
```

**A code is a status, and it still gets a hue.** `404` is information, `403` a warning and `500` danger. Each code renders as its numerals, set large in the serif, because "404" is the most recognisable thing that can be said about a missing page. The four tone statuses get a tinted disc with a glyph, the same treatment **Alert** uses.

**Codes come with a title.** A bare `<Result @status='404' />` reads "This page does not exist". `403` and `500` have their own defaults. Any `@title` wins. A tone status without a `@title` renders no heading, because there is no honest default for "success".

**Tone spellings resolve.** `@status` accepts the kit's tone aliases (`error`, `destructive`, `positive`, `notice`…) and a number (`@status={{404}}`). Anything unknown falls back to `info` rather than emitting a status nothing paints.

**The glyph is still** (Law 5). An outcome is not a process, so nothing spins, bounces or draws itself in.

## Prior art

**Ant Result** is the direct model: `status` (`success | error | info | warning | 404 | 403 | 500`), `title`, `subTitle`, `icon` and `extra`, with a bespoke illustration for each code. **shadcn Empty** and **Chakra EmptyState** cover the no-data half with a media / title / description / content layout. **MUI** has no component; agents compose Typography and a Button.

Where Pretui is better: **the heading is a heading.** Ant renders the title as a styled `div`, so a screen reader user navigating by headings never finds the page's main message. Here it is `role="heading"` with a level the caller sets. **Codes have default titles**, so a route that only knows the status still says something readable. **Tone spellings from any kit resolve**, so `status='error'` from an Ant-trained agent works.

Where it is thinner: **no illustrations.** Ant draws a scene for each code. Here the code is typography, and `<:icon>` is the escape hatch. **No `subTitle` node**: `@description` is text, and markup goes in the default block. **No live announcement**: a Result that appears after a submit is not announced automatically. See Accessibility.

## Accessibility

No APG pattern. A Result is a section with a heading, and it is only as good as that heading.

- **The title is `role="heading"`** with `aria-level` from `@headingLevel` (default 2). Pick the level that fits the page outline. On a dedicated error route it is often the page's `h1`. The tests assert the role, the default level and an override.
- **The glyph and code numerals are `aria-hidden`.** "404" is set as decoration next to a title that says the same thing in words, so it is not read twice. The tests assert the mark is hidden.
- **Nothing is announced on arrival.** When a Result replaces a form after a submit, move focus to its heading, or add `role='status'` through attributes, so assistive technology hears the outcome. The component cannot know whether it arrived after an action or on page load.
- **Colour is not the message.** The hue backs up the title and never replaces it: a `danger` Result with the title "Done" is a contradiction the component will render.
- **The actions in `<:extra>` are ordinary Buttons.** Put the likely next step first.

## Theming

`--pretui-result-hue` (set from the status: `--success`, `--pretui-info`, `--warning` or `--destructive`), `--pretui-result-code-size` (the numerals, default 4.5rem), `--pretui-chip-mix` (the disc tint, shared with **Chip** and **Alert**), `--font-serif` (title and numerals), `--text-heading`, `--text-ui-md`, `--foreground`, `--muted-foreground`, `--card`, `--border`, and `--space-2` / `--space-3` / `--space-6` / `--space-9` for rhythm.

A season changes every Result through the four status hues and the chip mix, the same knobs that retune Alert and Chip. The centred layout, the 3.5rem disc and the description's 44ch measure are fixed.

## React ecosystem

| Agent types                             | Give them                               |
| --------------------------------------- | --------------------------------------- |
| Ant `<Result status="404" title extra>` | `@status='404'` + `@title` + `<:extra>` |
| Ant `subTitle`                          | `@description`                          |
| Ant `icon`                              | `<:icon>`                               |
| `status="error"`                        | `@status='error'` (resolves to danger)  |
| shadcn `<Empty>` for no data            | **EmptyState**                          |
