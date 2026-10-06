## What it is

A settled agent turn, folded to one line with an expand affordance. Use it to keep a long transcript readable: turns the user has already dealt with collapse to a summary, and the live turn stays open. If the collapsed unit is a *step* within a turn rather than a whole turn, **Fold** is the containment primitive. If it is a diff, **DiffBlock** collapses itself.

## The contract

```
@summary: string   (required)
@onExpand?: () => void
Element: HTMLDivElement
```

Two args, and the second is the interesting one.

**It does not own its expanded state.** Unlike **Fold**, which owns open, default-open and change args, CollapsedTurn is *only* the collapsed representation — expanding calls `@onExpand` and the caller swaps in the real turn. That is the correct factoring for a transcript: an expanded turn is not "this component with more content", it is a completely different tree of **WorkItem**s, **DiffBlock**s and **ResultCard**s, and rendering both would double the transcript's cost.

**`@summary` is required**, the same way **Fold** requires its receipt, and for the same reason: a collapsed thing that does not say what it is turns a settled transcript into a column of chevrons.

## Prior art

The reference is the chat-transcript collapse in agent products — Claude Code's collapsed turns, Cursor's folded composer history, ChatGPT's "show previous messages". None is a component; all solve the same problem, which is that an agent session accumulates more output than anyone will re-read.

The design decisions worth comparing:

- **Most implementations collapse by scroll position or age.** Here collapse is a rendering choice the caller makes, which means the policy ("collapse everything before the last approval gate", "collapse on settle") lives where the transcript's semantics are known rather than in a scroll heuristic.
- **Most keep the collapsed content in the DOM** and hide it, because expanding is then instant. This does not — `@onExpand` is a callback, so the caller mounts the real content. Slower to expand, dramatically cheaper for a long session, and the right trade when a turn contains a 400-line diff.

Where it is thin: **no count or shape in the summary contract** (you compose the sentence yourself, so "3 steps, 2 files changed" is your string to build), no timestamp, no state (a turn that failed and one that succeeded collapse identically unless your summary says so), and no re-collapse — once expanded, returning to the folded view is the caller's problem too.

## Accessibility

No APG pattern beyond **Disclosure**, and this is a disclosure with the content in someone else's hands.

Gaps:

- **The expand affordance's semantics need checking.** A disclosure trigger should be a `<button>` with `aria-expanded="false"` and, ideally, `aria-controls`. Because the content is not rendered by this component, `aria-controls` cannot point at anything and `aria-expanded` is arguably wrong too — the button does not expand a region, it asks the caller to replace this component. The honest markup is a plain button whose name says what it does ("Show turn: 3 steps, 2 files changed"), and that is worth being deliberate about rather than reaching for `aria-expanded` by reflex.
- **`@summary` should be the button's accessible name**, not adjacent text with a separate chevron button labelled "Expand". Verify which it is; the second shape produces a transcript of identically-named "Expand" buttons.
- **The transition is not announced.** After expanding, focus is wherever it was and a screen-reader user has no signal that a large amount of content just appeared above or below them. Moving focus to the newly rendered turn is the caller's job and nothing prompts for it — this is the most consequential gap, because the content arriving is the whole point of the interaction.
- **No indication of what was collapsed for a screen-reader user beyond the summary string.** Since the caller writes it, the quality of the accessible experience is entirely the quality of that sentence — which makes it worth saying explicitly: **write summaries that would be useful read aloud with no visual context.**
- **A collapsed turn removes its content from the accessibility tree entirely**, so `Ctrl+F`, screen-reader find, and browser search will not locate text inside collapsed turns. For a long session that is a real discoverability loss and there is no search affordance to compensate.

## Theming

`--muted-foreground` (the summary line — collapsed turns should recede), `--border` or `--line-strong` (any rule separating it from live content), `--hover` (the expand affordance), `--text-ui-md` or `--text-ui-sm`.

The territory's rule applies here more than anywhere: **settled work recedes.** A season must keep the collapsed summary visibly quieter than a live **WorkItem** — if a folded turn and a running one read at the same weight, the transcript stops showing where the agent actually is, which is the one thing it exists to do.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
