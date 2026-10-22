## What it is

A multi-step flow: an ordered set of stages, a rail showing where you are, a panel for the active step, and a Back / Skip / Next footer.

## The contract

```
@steps (required) — the ordered stages
@activeIndex?, @defaultActiveIndex?, @onStepChange? — the position; the callback
             fires on every move, BACKWARDS INCLUDED
@onComplete? — fires when the terminal step's primary is activated and allowed
@onRefused?  — fires when a forward move was REFUSED, with the index refused at
@canAdvance? — coarse override of the per-step valid flag. Resolution order:
               @canAdvance ?? step.valid ?? true
@navigation? — 'linear' (Back and Next only) | 'visited' (default — back to anywhere
               already reached, forward through the gate) | freer still
@label?      — accessible name for the rail. Default 'Steps'
@railVariant?, @summary?, @hideTitle?
@busy?       — the primary is busy; an async commit is in flight
@backLabel?, @nextLabel?, @skipLabel?, @completeLabel?, @emptyTitle?

<:step>   the active step's content; receives (step, index, api)
<:rail>   replaces the StepList rail entirely — this is where a clickable rail goes
<:footer> replaces the Back / Skip / Next footer
```

**`@onRefused` is the arg most wizards do not have.** A forward move blocked by validation is an event worth knowing about — it is where a caller shows *why* — and a wizard that simply does nothing when Next is pressed is the most frustrating version of this component.

**Validation resolution is stated in the contract**: `@canAdvance ?? step.valid ?? true`. The coarse override wins, then the step's own flag, then permission.

**`@navigation='visited'` is the default**, which is the humane middle: you can go back to anything you have reached, and forward only through the gate.

**`@onStepChange` fires on backwards moves too**, so a caller tracking progress is never out of step.

## Prior art

The wizard/stepper in every kit, and SLDS's in particular.

Where Pretui is better: the refusal event, the stated resolution order, and the rail being a real **StepList** rather than a bespoke set of dots — so step state and its accessibility come from one place.

Where it is thinner: no branching — steps are a linear array — no per-step async validation contract beyond `@busy`, and no persistence of a partially-completed flow.

## Accessibility

- **The rail is a StepList**, so complete, current and upcoming are conveyed as text rather than by colour.
- **A refused move needs saying.** The component reports it; the caller renders the reason, and a wizard that refuses silently is inaccessible to everyone equally.
- **`@busy` locks the primary rather than removing it**, so focus stays where the reader put it.
- **`<:rail>` is where a clickable rail goes**, and a caller who builds one inherits responsibility for its keyboard model — the default rail is not interactive.
- **The step panel is titled unless `@hideTitle`**, which is what lets a screen-reader user confirm the move happened.
- **Skip is a named control**, so an optional step is visibly optional rather than being a Next that behaves differently.

## Theming

The rail is **StepList**'s, the footer is built from the kit's **Button**, and the panel takes the shared surface tokens.

Nothing is wizard-specific, which is what keeps a flow looking like the application it interrupts rather than like a separate installer.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
