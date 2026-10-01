## What it is

The gate: a bar stating how many changes await approval, with Keep / Revert / Accept-all actions. Use it at the end of a run of **WorkItem**s an agent has staged but not committed. If the agent needs an *answer* rather than an approval, **AgentQuestion**. If it is reporting something it already did, **ResultCard**. If the whole surface is blocking, that is a **Dialog** and probably too heavy for a transcript.

## The contract

```
@count?, @message?, @destructive?
@onKeep?, @onRevert?, @onAcceptAll?
```

**The default message is generated with correct grammar**: `1 change awaits your approval` / `3 changes await your approval` — the noun *and* the verb both inflect. That is a small thing that most generated strings get wrong ("1 changes await"), and it matters here because this sentence is the last thing a user reads before committing an agent's work.

**`@destructive` is the territory's hard rule, stated in the source: destructive operations always ask, regardless of autonomy level.** An agent configured to act freely still surfaces this footer when the change cannot be undone. That is a policy encoded in a component rather than left to a config flag, which is the right place for it.

`@onAcceptAll` is separate from `@onKeep` deliberately — "keep this" and "accept everything" are different commitments and should not be the same button.

## Prior art

No component library ships an approval gate. The references are product surfaces: Claude Code's diff-approval prompt, Cursor's accept/reject bar, GitHub's "Files changed" review controls, and the general pattern of a **staged-changes gate** from version control.

The design decisions worth comparing against those:

- **Git's model is the right ancestor**, and the vocabulary follows it: changes are *staged*, then kept or reverted, and the receipt survives. Compare the common agent-UI pattern of an undo toast, which puts a time limit on the decision.
- **Three actions, not two.** Most accept/reject bars offer a binary; separating "keep" from "accept all" acknowledges that a user reviewing a long run wants to commit incrementally and then bulk-commit the rest.
- **The count is in the sentence, not in a badge.** "3 changes await your approval" is a claim the user can check; a badge reading "3" beside two buttons is not.

Where it is thin: **no per-change navigation** (you cannot step through what you are approving from here — that is **DiffBlock**'s job and there is no link between them), no "review each", no keyboard shortcut affordance, and no busy state while the commit is in flight.

## Accessibility

No APG pattern. The relevant criteria are WCAG **3.3.4 Error Prevention** (this *is* the error-prevention mechanism for agent actions), **4.1.3 Status Messages** and **2.4.3 Focus Order**.

Gaps, and the first two are serious given what this component gates:

- **The footer's appearance is not announced.** This is the moment the agent stops and needs a human, and it arrives silently — a screen-reader user reading a transcript has no signal that work has paused pending their decision. A live region announcing "3 changes await your approval" is not optional for this component; it is the point of it. `role="alert"` (assertive) is defensible here in a way it is not for most components, since the user genuinely cannot proceed. **This is the highest-value fix in the territory.**
- **`@destructive` is a visual state with no announced counterpart.** The destructive dress presumably tints the bar; nothing tells a screen-reader user that the pending changes cannot be undone. Given that "destructive operations always ask" is the stated law, the *reason* they are being asked must reach everyone — put it in the message text, not in the colour.
- **Focus is not moved to the footer.** When an agent stops and asks, the user's focus is wherever it was. **Form**'s `focusInvalid()` solves the equivalent problem for refused submits, and the same treatment applies here.
- **Accept-all has no confirmation.** A single button commits every staged change; combined with the lack of announcement, a screen-reader user can commit an agent's entire run without ever hearing what it contained. **WCAG 3.3.4** asks for reversibility, checking or confirmation for actions with significant consequences.
- **The button labels are generic.** "Keep" and "Revert" outside their sentence do not say what is being kept — `aria-describedby` pointing at the message would fix it.
- **No busy state.** Nothing prevents a double-commit while the first is in flight; **Button** has `@busy` and it is not wired here.

## Theming

`--card` or `--inset` (the bar), `--border` and `--pretui-shadow-hairline` (its edge), `--foreground` and `--muted-foreground` (the message), plus **Button**'s full token set for the three actions. The destructive dress reads `--destructive`.

The three buttons use the kit's **Button**, so tone and appearance travel with the season — Keep is the affirmative, Revert the quiet outlined one, and the destructive variant re-tones them. A season must keep the destructive dress clearly distinct from the normal one at a glance; this is the one bar in the product where mistaking the state is expensive.
