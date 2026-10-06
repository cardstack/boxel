## What it is

**Transmutation**: three cuts of one truth, in one element. A tool call is a VERB (`READ`), a LABEL (`README.md`), and a CALL (`read_file(path="README.md")`) — and which of the three you want depends on whether you are skimming, reading, or debugging. Use it for every tool invocation an agent reports. If the thing has a state and a lifecycle, that is **WorkItem**; Transmute is the *name* of an action, not its progress.

## The contract

```
@verb: string   (required)
@label?, @call?
@tier? 't0' | 't1' | 't2'   (default 't1')
Element: HTMLSpanElement
```

**The verb never moves; only the tail grows.** All three tiers are in the DOM at once, and the tier controls which tails have width — a `grid-fr` morph with a quint-out easing. So promoting a tier is a width animation on the tail, not a content swap, and the verb stays anchored on the left. In a column of twenty tool calls that means the verbs form a readable left rail that does not jitter as tiers change.

**Hover promotes one tier, in pure CSS — there is no JS state.** T1 hovered shows T2, T0 hovered shows T1. That is the whole interaction, and it costs nothing per instance.

`@tier` sets the resting tier. `t0` for a dense trace, `t1` for a normal transcript, `t2` for a debugging view.

## Prior art

Nothing in the component-library world does this. The closest analogues are **progressive disclosure of a call signature** in developer tools — Chrome DevTools' collapsed console objects, a stack frame that expands to its arguments — and the general typographic idea of a *hierarchy of detail in one line*, which is closer to editorial design than to UI components.

What is genuinely novel here, and worth naming as the improvement: **the three representations are the same object, not three states of a toggle.** The usual solution is a disclosure — click to see the full call — which costs an interaction and moves the layout. Here all three exist simultaneously and the tier is a width, so the transitions are continuous, reversible on hover, and free.

The related decision is that **the verb is the invariant**. Most agent UIs lead with the target (`README.md — read`) or with the full call; leading with the verb means a scan down the left edge answers "what has this agent been doing" in one pass. That is a real information-design choice, and it is the reason the animation is constrained to the tail.

Where it is thin: no click-to-pin (hover is the only promotion, so it is pointer-only), no copy affordance for the call string, and no truncation strategy for a long `@call` — a wide call at T2 will push the row.

## Accessibility

No pattern governs it, and this is where the design's cleverness costs something.

- **All three tiers are in the DOM at all times.** The tier is expressed by width, not by presence — so a screen reader encounters the verb, the label **and** the call on every single row, regardless of `@tier`. A T0 trace that looks like a column of one-word verbs announces as a column of full function calls. That is the component's central accessibility problem and it is a direct consequence of the grid-fr morph. The fix is `aria-hidden` on the tails that are not at the current tier — which does mean the hover promotion would then also need to update it, or accept that the hover reveal is sighted-only.
- **The hover promotion is pointer-only.** There is no `:focus-within` companion, no keyboard route to T2, and no focusable element at all — so a keyboard user cannot promote a tier. If the DOM issue above is fixed by hiding tails, this becomes a genuine information loss rather than a redundancy.
- **The verb is 10px mono uppercase at `--muted-foreground`**, which is the smallest, quietest text in the kit. Check it against **WCAG 1.4.3** per season; it is a strong candidate to fail.
- **`text-transform` is not in play** (the verbs are presumably authored uppercase), so screen readers may spell out short all-caps verbs — "R E A D". Authoring them in normal case and uppercasing in CSS, as **Label** does, avoids that.
- **No semantic relationship between the three parts.** They are three sibling spans; nothing says the label is the verb's object.
- **Motion**: the grid-fr morph runs on hover. There is no `prefers-reduced-motion` branch mentioned; verify one exists, since a column of rows that all animate on pointer transit is exactly the kind of incidental motion that setting is for.

## Theming

`--font-mono` and `--muted-foreground` (the verb voice, at a fixed 10px / 600 / 0.06em), plus the tail inks and the morph's easing and duration.

The verb's 10px size and letterspacing are hard-coded rather than tokenised, which is an inconsistency with the rest of the kit's eyebrow voice (**Label**, **Panel**, **DataGrid** all read `--text-ui-xs` and `--track-eyebrow`). A season retuning the eyebrow scale will move those three and not this one.

The tail inks should recede relative to the verb — the tier hierarchy is carried by ink weight as much as by width, so a season that flattens the ink ramp loses the sense that T2 is *more detail* rather than *more text*.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
