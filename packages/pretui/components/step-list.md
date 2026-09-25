## What it is

An ordered rail of stages with derived state: complete, current, upcoming — as a numbered rail or as a segmented bar.

It is the progress primitive the rest of the kit composes: **Wizard**, **SessionPrep**, **StepsWithMedia** and **Onboarding** all render one rather than drawing their own dots.

## The contract

```
@steps (required) — the ordered stages; one <li> each, in the order given
@current?  — index of the current step; derives complete/current/upcoming for steps
             without an explicit state
@label?    — list label announced by assistive tech. Default 'Steps'
@variant?  — 'steps' (default) the numbered-marker rail with connector lines |
             'track' the segmented bar rail, for a pipeline read at a glance
@summary?  — render the completion summary above the rail ('3 of 5 complete')
@summaryFormat? — wording for that summary; receives (completed, total)
@announce? — announce the active step's state and detail through a polite live
             region when either changes. ON BY DEFAULT
```

**Both variants are the same markup, the same semantics and the same state palette** — only the arrangement differs. That is what lets a caller switch a wizard's rail to a pipeline view without any of the meaning changing.

**State is derived from `@current` for steps that do not declare their own**, so the common case is one index rather than a state per step.

**`@announce` defaults to on**, and the reason is stated in the source: a rail whose stage flips from running to blocked while nobody is looking at it has told a sighted reader something and told everyone else nothing. Live regions do not announce their initial content, so it is silent on mount.

## Prior art

The stepper in every kit.

Where Pretui is better: the live region on by default with a reasoned default, and two arrangements over one semantic model rather than two components.

Where it is thinner: no branching, no per-step actions, and no vertical variant distinct from the numbered rail.

## Accessibility

- **It is an ordered list**, so position and count come from the markup rather than from a rendered "3 of 5".
- **`@announce` is the component's most considered decision.** A progress rail is the definitional case of a state change happening away from the reader's attention, and defaulting the live region on — while staying silent on mount — is the right trade.
- **State is text, not colour.** Complete, current and upcoming are announced as such.
- **`@summary` is wired to the list**, so "3 of 5 complete" is associated rather than floating above it.
- **`@summaryFormat` exists for localisation**, since the default sentence is English word order.

## Theming

The state palette is the kit's semantic scale, shared across both variants; the rail geometry is the only thing that changes between them.

Sharing the palette is what keeps a track rail and a numbered rail legible as the same information — which matters because a product often uses both, on different screens, for the same process.
