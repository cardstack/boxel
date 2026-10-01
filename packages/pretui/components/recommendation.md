## What it is

The agent proposing a decision: a question, a best option presented in full, and the alternatives behind a drawer.

## The contract

```
@question (required) — what is being decided
@options (required)  — the options, BEST FIRST
@selectedKey?  — controlled selection key
@onSelect?     — fires when the reader switches to another option
@onAccept?     — fires when the reader accepts the active option
@accepted?     — the decision has already been taken (controlled)
@acceptedLabel?      — default 'Accepted'
@alternativesLabel?  — default 'Alternatives'

<:body> — rich body for the active option, replacing its body string
```

**Options are best-first, and that ordering is the recommendation.** The component does not rank; it presents what it was given in the order it was given, with the first one active.

**Selecting and accepting are separate events.** Switching to another option is exploration; accepting is the decision, and a component that fired one callback for both would make "I looked at the alternative" indistinguishable from "I chose it".

**`@accepted` is controlled**, because whether a decision has been taken lives with whatever recorded it.

## Prior art

The recommendation and option-comparison surfaces in agent products.

Where Pretui is better: the select/accept split, and the alternatives being a drawer rather than a grid of equally-weighted cards. A recommendation that presents three options identically is not a recommendation.

Where it is thinner: no comparison view across options, no per-option reasoning trace, and no "none of these" path — declining means doing nothing, which the component cannot report.

## Accessibility

- **The question is the block's name**, so the decision is findable rather than being prose above a group of controls.
- **The active option is announced as active**, not merely styled as such — a reader arriving at the block is told which one is being recommended.
- **Alternatives are behind a real disclosure**, so they are reachable by keyboard and inert when closed.
- **Accept is a distinct, named control.** A decision should never be a side effect of navigating.
- **The accepted state is a receipt.** Once taken, the block reads as what was decided rather than as a live question — the same settle **InteractiveInput** makes.
- **Best-first ordering is conveyed by order**, which survives without sight, rather than by size or emphasis alone.

## Theming

The block uses the agentic set's attention and tier tokens, the kit's disclosure for the drawer, and **Button** for accept.

A recommendation is one of the few places in an agent UI where the kit's accent genuinely carries meaning — the active option wears it — so it follows the season's primary rather than a local colour.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
