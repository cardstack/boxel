## What it is

The usage page: a component's example, its interactive knobs, its API table and its source, in one frame. Use it to document a component. Every page in the Pret UI catalog is one of these. If you only need the artboard frame, **Viewport**; if you need the theme switcher, **ThemeFrame**.

## The contract

```
@name?, @description?, @slug?, @source?, @viewportMode?
<:description>  <:example>
<:api as |Args|>       — Args.{ String, Bool, Number, Array, Object, Component, Action, Yield, Base }
<:cssVars as |Css|>    — Css.Basic
```

**The invocation surface is ember-freestyle's, verbatim.** Same block names, same `Args.*` hash, same `<:cssVars>`. That is the verbatim-reuse directive: a usage page written for ember-freestyle works here unchanged, and a Pretui usage page could be lifted back out.

**The `<:api>` block is yielded twice, through two lenses.** The interactive knobs render as a right-hand **property list** (`mode='prop'`); the API table below documents types, descriptions and defaults (`mode='doc'`). One authored block, two presentations — so a page author never writes the same argument twice and the knobs cannot drift from the docs. That is the layout evolution over upstream, and it is the reason `ArgsMode` exists at all.

## Prior art

**ember-freestyle** is the upstream, and this is a port rather than a reimplementation. Against the wider field: **Storybook** is the reference, with args/argTypes, a controls panel, an autodocs table and a source viewer — structurally the same four regions. **Ladle** and **Histoire** are lighter Storybook shapes.

Where the Pretui port differs, and each is a deliberate delta:

- **The machinery wears the kit.** **Select**, **Input**, **Switch** and **Slider** are the knob controls; **Table** renders the API docs; **Viewport** frames every example. So the documentation surface dogfoods the components it documents — a broken Select breaks its own usage page, which is a useful forcing function Storybook's React-based panel does not have.
- **The dual-lens `<:api>`** (above). Storybook derives its controls table from types; freestyle makes you author knobs; this makes you author once and renders both.
- **No ember-freestyle service.** The upstream keeps a global service for section registration; this is component-local, which suits a realm where a page is a card.
- **Plain `<code>` for `@source`.** No syntax highlighter — Law 9 forbids vendoring one, and the trade is stated rather than hidden.
- **Labeled controls**, where upstream's are bare.

Where it is behind Storybook, honestly: no addons, no interaction testing, no accessibility panel, no visual regression, and no auto-generated argTypes.

## Accessibility

No pattern governs it; it is a page composed of the kit's own components, and it inherits their contracts — including their gaps.

Gaps worth knowing, because a documentation surface is read by exactly the people who care about these:

- **Only part of the page has heading structure.** Properties, API and CSS Variables are headed by `h2`s, so heading navigation reaches the knobs and the tables; Properties is an `<aside>` named "Properties", and each table carries its heading as its name. The description and the example have no heading or region, so a screen-reader user cannot jump to "the example".
- **`@name` is not a heading here.** It only labels the Viewport's artboard; the page's heading is the Spec's `h1`, and the section titles are `h2`s under it.
- **The knobs and the API table describe the same arguments and are not linked.** A user reading a row in the docs table has no route to the control that changes it.
- **The `<code>` source has no language annotation.** It scrolls inside a named region ("Usage source") with a tab stop, so a keyboard user can reach the end of a long line, and the Copy button stays in view beside it.
- **Changing a knob re-renders the example silently.** A `role="status"` region would make the cause-and-effect available; without it, a screen-reader user changing a Select has no confirmation that anything happened.
- **The example region contains arbitrary live components**, so the page's overall accessibility is whatever is being demonstrated — including deliberately-broken states. That is unavoidable and worth stating: a usage page is not a claim about the component's accessibility.

## Theming

Composes **Viewport**, **Table**, **Select**, **Input**, **Switch**, **Slider**, **SegmentedControl**, **CopyButton** and **Popover**, so it consumes their token sets rather than defining many of its own. Page structure uses `--card` with `--card-foreground`, `--border`, `--muted-foreground`, `--boxel-border-radius` and the `--boxel-sp-*` scale; the section titles take the eyebrow role (`--boxel-eyebrow-*`), and the source is set in `--font-mono` at `--boxel-font-size-xs`. The Properties panel and the two tables are named by their `h2`s.

The whole page renders inside the theme island, so a theme change re-dresses both the documentation chrome _and_ the example — which is the point, and is what **ThemeFrame** exists to drive.
