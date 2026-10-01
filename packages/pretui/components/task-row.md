## What it is

One task in a queue: a state ring, a claim, an optional amount, a status pill, and a receipt you can open.

## The contract

```
@state?      — where the task is in its life. Default 'pending'
@index?      — queue position, shown inside the ring while pending or running
@label (required) — the claim
@amount?     — right-side tabular figure, e.g. '7 SKUs'
@statusText? — pill wording
@details?    — the receipt; WITHOUT any, the row does not offer to open
@defaultOpen?, @open?, @onOpenChange? — the disclosure
@flat?       — flat list style, no capsule shadow or radius, for dense stacks
```

**A `failed` row should pass `@statusText` and name the error.** The default "Failed" is a placeholder, not an explanation — and the contract says so, because a queue of rows all saying "Failed" is a queue with no information in it.

**Without `@details` the row does not offer to open.** Same rule as **CompactionChip**: no disclosure onto nothing.

**`@index` sits inside the ring while pending or running** and gives way once the task settles — position matters while you are waiting and not afterwards.

**`@amount` is a tabular figure**, so a column of rows aligns.

## Prior art

The task-queue row in agent and CI surfaces.

Where Pretui is better: the details gate, and the explicit push toward naming a failure rather than labelling it. Both are small contract decisions that change what a queue of twenty rows tells you.

Where it is thinner: no retry or cancel affordance — a row reports, it does not act — no nested subtasks, and no elapsed time.

## Accessibility

- **The disclosure carries the full contract** — real button, `aria-expanded`, `aria-controls`, inert when collapsed.
- **State is carried by the pill's text**, not by the ring's colour alone. The ring is the visual shorthand; the text is the fact.
- **`@statusText` naming the error is an accessibility property.** A screen-reader user moving through a queue hears the pill; "Failed" twenty times conveys nothing about which one to look at.
- **`@amount` is announced after the label**, so a row reads as a claim and its quantity.
- **`@flat` changes appearance only**; the semantics of a dense stack are identical.

## Theming

The row takes the agentic set's shared state and tier tokens; `@flat` drops the capsule shadow and radius rather than switching to a different treatment.

That is what lets the same component serve a spaced summary and a dense queue without a second implementation — and keeps the state colours identical between them, which matters when a reader moves from one view to the other.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
