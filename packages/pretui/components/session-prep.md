## What it is

The waiting surface before a session is ready: a rail of preparation steps, a note explaining why the wait exists, and a way to skip it.

## The contract

```
@steps (required) — the preparation steps, in order
@title?     — heading. Default 'Preparing your session'
@note?      — one line under the heading explaining WHY the wait exists
@onSkip?    — fires when the reader skips the remaining preparation
@skipLabel? — default 'Skip preparation'
@variant?   — rail presentation, passed to StepList. Default 'steps'

<:default> — extra content below the rail: a model picker, a skill chooser
```

**`@note` is where the wait is justified.** A progress rail with no explanation is a loading screen; one that says why it is doing what it is doing is an explanation. The arg exists to make that the expected shape rather than an afterthought.

**Skip is offered, not assumed.** No `@onSkip`, no skip button — the same rule as every other conditional affordance in the kit.

**The rail is a real StepList**, so step state derivation and its accessibility come along rather than being re-implemented.

**`<:default>` is for choices made during the wait**, which is the design's one genuinely good idea: a wait is dead time, and filling it with the setup questions that would otherwise come next is better than a spinner.

## Prior art

The session-warmup screens in agent products.

Where Pretui is better: the note and the yielded block. Most warmup screens are a spinner with a rotating message; making the explanation an argument and the wait usable turns it into a step rather than an obstacle.

Where it is thinner: no time estimate, no per-step failure state — a step that fails is StepList's to express, and this block does not model recovery — and no resume after skip.

## Accessibility

- **The block is a named region** taking its name from `@title`.
- **Step state comes from StepList**, which conveys complete, current and upcoming as text rather than by rail colour.
- **The skip control is a real button**, so the wait is escapable by keyboard.
- **`@note` is associated with the heading**, giving the reason a place that is announced rather than being loose text.
- **Content in `<:default>` is reachable while the rail progresses**, which is the point — a wait that traps focus in a progress indicator wastes the reader's time twice.

## Theming

Everything comes from **StepList** and the kit's block tokens; the component adds no surface.

That keeps a warmup screen looking like the application it is warming up rather than like a splash screen, which matters because it is the first thing anyone sees.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
