## What it is

A walkthrough: an ordered set of steps with an illustration, a rail showing progress, and a skip.

## The contract

```
@steps (required) — the walkthrough, in order
@current?, @defaultCurrent?, @onStepChange? — the position
@onDone?    — fires when the reader finishes the last step
@onSkip?    — fires when the reader leaves early; OMIT TO HIDE THE SKIP
@label?     — accessible name for the whole scene. Default 'Getting started'
@doneLabel? — final-step button wording. Default 'Get started'
@skipLabel? — default 'Skip'
@variant?   — rail presentation, passed to StepList. Default 'track'

<:media> — the step's illustration; receives the step and its index
```

**Omitting `@onSkip` hides the skip**, which is the kit's conditional-affordance rule applied to the one control readers look for first.

**The rail is a StepList in `track` mode**, so progress is conveyed as text rather than by a row of dots.

**`@doneLabel` defaults to "Get started"** rather than "Done", because the last step of an onboarding is a beginning.

## Prior art

The product-tour and walkthrough components.

Where Pretui is better: not much structurally — it is a stepped scene. The value is that the rail is a real StepList rather than dots, so progress is announced, and that skip is a first-class arg rather than a footnote.

Where it is thinner: no anchored tooltips pointing at real UI — this is a scene, not a coach-mark tour — no branching, and no persistence of where someone stopped.

## Accessibility

- **The scene is named**, defaulting to "Getting started".
- **Progress comes from StepList**, so "step 2 of 5" is available as text rather than by counting filled dots.
- **Skip is a real, named control**, and hiding it is a deliberate act with a visible cost: an onboarding with no exit is a modal trap.
- **`<:media>` illustrations are decoration unless the caller says otherwise** — an illustration carrying meaning needs its own alt text.
- **Moving backwards is allowed** through `@onStepChange`, which matters for anyone who moved past something too quickly.

## Theming

Everything comes from **StepList** and the kit's block and button tokens.

An onboarding that themed independently would be the first thing a new reader sees and the one screen that does not look like the product — which is the exact opposite of what it is for.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
