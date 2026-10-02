## What it is

The agent asking the reader a question mid-run: a prompt, a set of typed choices, and a re-run control that settles into a receipt once answered.

## The contract

```
@verb?    — the tier verb. Default 'INPUT', matching the WorkItem grammar
@prompt (required) — what is being asked
@detail?  — a second line of context under the prompt
@options? — the typed choices; omit and supply <:picker> instead
@value?, @defaultValue?, @onValueChange? — the selection
@onRerun? — fires when the reader commits: the re-run
@answered? — settled state
```

**Once `answered`, the picker is disabled and the block reads as a receipt** rather than a live request. That is the quiet settle the kit's attention grammar asks for: a transcript should not be full of questions that look like they are still waiting.

**`@verb` matches the WorkItem grammar** so an input request sits in a run's timeline as one more tiered entry rather than as a foreign element.

**`<:picker>` replaces `@options`** for a question whose answer is not a flat list.

## Prior art

The inline question surfaces in agent products, and the JSX design mirror these descend from.

Where Pretui is better: **it is a real `<fieldset>` of native radios instead of a div soup of swatches.** That single choice is where the arrow keys, Home/End and grouped announcement come from — all of it free from the platform, none of it re-implemented, and all of it missing upstream.

Where it is thinner: single-select only — no multi-choice or free-text answer — no timeout or default-after-waiting, and no way to answer several pending questions at once.

## Accessibility

- **A `<fieldset>` with a legend, containing native radios.** The group is announced as a group, the options as its members, and the keyboard contract is the platform's.
- **The settled state disables rather than removes.** An answered question stays readable as a receipt, so a reader moving back through a transcript can see what was asked and what was chosen.
- **`@prompt` is the legend**, so the question is announced when the group is entered rather than being loose text above it.
- **`@detail` is associated with the group**, not left as an adjacent paragraph.
- **The re-run is a separate, named control**, so committing is deliberate rather than happening on selection.

## Theming

The block takes the agentic set's shared tier and attention tokens, and the radios are the kit's own — nothing here defines a surface.

That is what makes an input request look like part of the run rather than like a modal interrupting it, which is the entire design intent: the agent is asking inside its work, not stopping to open a dialog.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
