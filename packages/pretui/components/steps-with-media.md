## What it is

A marketing-page block pairing a numbered step list with a media panel: eyebrow, title, lead, steps on one side, a picture or a live component on the other.

## The contract

```
@eyebrow?, @title?, @lead? — the heading stack
@steps (required) — handed straight to StepList
@current?     — index of the current step; StepList derives complete / current /
                upcoming for steps without an explicit state
@variant?     — StepList presentation: 'steps' (numbered rail) or 'track'
@summary?     — show StepList's derived completion summary
@stepsLabel?  — accessible name for the step list. Defaults to the title
@asset?       — the media panel's asset; routed by MediaViewer
@mediaSide?   — which side the media sits on VISUALLY at wide widths. Default 'start'
@ratio?       — hold the media panel at a fixed CSS aspect-ratio
@headingLevel? — heading level for the title in the host page

<:media>   — replaces the media panel: a BrowserFrame, a Chart, a Scene
<:default> — anything under the step list
```

**`@mediaSide` moves the media visually and never in source order.** Source order is always content-first, so the reading order is the same whichever side the picture is on. A block that reordered the DOM to move a picture would change what a screen reader encounters first based on a visual preference.

**`@headingLevel` exists because a block does not know its page.** A section title that is an `<h2>` on one page and an `<h3>` on another is the caller's decision, and hardcoding it is how document outlines break.

**The media panel routes through MediaViewer**, so an `@asset` of any kind renders correctly; `<:media>` replaces the panel entirely for anything that is not an asset.

**`@ratio` reserves the panel** so the block does not reflow when the media lands.

## Prior art

The "how it works" section every marketing page builds by hand.

Where Pretui is better: the visual/source-order split, the heading level as an argument, and the steps being a real **StepList** rather than a styled `<ol>` — so state derivation, the completion summary and the list's own accessibility come along.

Where it is thinner: one media panel and one step list, no alternating layout across several instances (the caller alternates `@mediaSide`), and no scroll-linked step advancement.

## Accessibility

- **Source order is content-first regardless of `@mediaSide`**, which is the block's most important property: visual arrangement and reading order are decided separately.
- **`@headingLevel` keeps the document outline correct** in whatever page the block lands in.
- **`@stepsLabel` names the step list**, defaulting to the title so it is never anonymous.
- **The step semantics are StepList's** — complete, current and upcoming are conveyed there rather than by position or colour here.
- **The media is decoration unless the asset says otherwise.** An `@asset` carries its own alt text through MediaViewer; a `<:media>` block owns its own.

## Theming

The block composes **StepList** and **MediaViewer** and takes the kit's shared block spacing and heading tokens rather than defining its own surface.

That is the right shape for a Block-tier component: it is an arrangement of other components, and a season retunes it by retuning them — a block with its own type scale would drift away from the sections above and below it on the same page.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
