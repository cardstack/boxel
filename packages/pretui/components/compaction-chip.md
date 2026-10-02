## What it is

The marker in a transcript where history was condensed: what was compacted, how much of it, and — once written — the summary that replaced it.

## The contract

```
@state?         — 'running' while compacting, 'done' once the summary exists
@runningLabel?  — label while running. Default 'Compacting long history'
@doneLabel?     — label once settled. Default 'History compacted'
@messageCount?  — how many messages were condensed
@toolCallCount? — how many tool calls were condensed
@summary?       — the written summary; WITHOUT one, the chip does not offer to expand
@defaultExpanded?, @expanded?, @onExpandedChange? — the disclosure
```

**Without `@summary` the chip does not offer to expand.** A disclosure that opens onto nothing is worse than no disclosure — the same rule as **TaskRow**'s details and **AssetWell**'s retry button.

**The two counts are separate because they are different things.** Twenty messages and two tool calls is a different compaction from two messages and twenty tool calls, and a single "22 items" hides which.

**`@state` is the caller's**, because compaction is something the host is doing, not something this chip performs.

## Prior art

The compaction marker in long-running agent sessions.

Where Pretui is better: the summary being the gate on the disclosure, and the counts being separated by kind. Most implementations render a line of text and nothing openable, which makes a compaction an irreversible gap in the transcript from the reader's point of view.

Where it is thinner: no way to reach the original messages — the summary is what remains — no partial or per-range compaction display, and no indication of *why* compaction happened.

## Accessibility

- **It is a disclosure with the full contract** — a real button, `aria-expanded`, `aria-controls` — and the collapsed content is inert rather than merely hidden.
- **The running and settled labels are both text**, so the state is announced rather than carried by an animation.
- **The counts are in the label**, so what was condensed is available without opening anything.
- **Expanding is offered only when there is something to read**, which means a reader is never sent into an empty panel.
- **A compaction is a gap in the record.** Making it a visible, named, expandable marker rather than a silent removal is the accessibility property that matters most here — the transcript says what it no longer holds.

## Theming

The chip takes the agentic set's shared tier tokens and the kit's disclosure treatment; the running state uses **TextShimmer**, the same as **Thinking**'s working label.

Sharing the shimmer is deliberate — "the agent is doing something" should look the same everywhere in a transcript, whether it is thinking or compacting.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
