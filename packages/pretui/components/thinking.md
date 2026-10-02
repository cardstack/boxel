## What it is

The agent's reasoning trace: a shimmering label while it works, a settled label when it is done, and a disclosure holding the rows it produced.

## The contract

```
@label?      — the shimmering label while @working. Default 'Thinking'
@doneLabel?  — the settled label, e.g. 'Thought for 4 seconds'. Default 'Done'
@working?    — the trace is still being produced
@rows?       — the trace itself
@query?      — a search-trace query line pinned above the rows
@defaultExpanded? — starting disclosure state; defaults to @working
@expanded?, @onExpandedChange? — controlled disclosure

<:default> — extra content appended inside the rail, below the rows
```

**The disclosure defaults to `@working`**, which is the right behaviour in both directions: open while thinking so the reader can watch, and collapsed once settled so a finished transcript is a list of conclusions rather than a wall of reasoning.

**`@doneLabel` is where the duration goes.** "Thought for 4 seconds" is the caller's string — this component never reads a clock.

**`@working` drives the shimmer**, which is **TextShimmer**'s treatment rather than a bespoke animation.

## Prior art

The reasoning-trace disclosure in Claude's and Copilot's surfaces.

Where Pretui is better: the collapsed subtree is genuinely inert. The JSX these descend from collapses content with `grid-template-rows: 0fr` and `opacity: 0` alone, which leaves the subtree in the accessibility tree **and tabbable** — a keyboard user tabs into a panel they cannot see. The kit's Disclosure adds `inert`, the platform's own answer, and wires `aria-controls`/`aria-expanded` from ids the component mints itself.

Where it is thinner: no per-row timing or nesting, no streaming append contract — rows arrive as a whole array — and no way to pin a single interesting row out of a long trace.

## Accessibility

- **Collapsed means inert**, not merely invisible. This is the fix that matters most in the whole agentic set, because the failure it prevents — tabbing into hidden content — is silent and complete.
- **`aria-expanded` and `aria-controls` are wired from self-minted ids**, so a caller never has to supply one and the relationship is always correct.
- **The shimmer is a treatment, not information.** "Working" is carried by the label text; the animation is decoration over it, and reduced motion drops it to the resting state.
- **The settled label should say something.** "Done" is a placeholder; "Thought for 4 seconds" is what a reader actually wants, and it is the caller's to provide.
- **A long trace is a lot of content.** Collapsing once settled is what keeps a transcript navigable by heading rather than by scrolling through reasoning.

## Theming

The rail, the disclosure and the shimmer all come from shared kit tokens — **TextShimmer**'s duration and spread for the working label, the disclosure's own transition for the reveal.

A trace that had its own type scale or its own animation curve would read as a different application embedded in the transcript, which is exactly what the agentic set is trying not to be.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
