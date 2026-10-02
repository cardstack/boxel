## What it is

The atom of the agentic territory: one unit of agent work, at one of three densities, showing its state in words. Use it for every step, action and run an agent reports. It is the row an agent transcript is made of; **Fold** nests them, **ApprovalFooter** gates them, **DiffBlock** shows what they changed, **ResultCard** shows what they produced.

## The contract

```
@tier? 'step' | 'action' | 'run'
@state?, @verb?, @title (required), @status?
@progressValue?, @progressMax?, @count?, @activity?
<:default>  <:footer>
```

**`@state` is an open string mapped through two tables, not an enum.** Nineteen states — `pending`, `preparing`, `running`, `applying`, `handoff`, `reconnecting`, `host-attached`, `fallback`, `ready`, `awaiting-approval`, `ask`, `input`, `completed`, `kept`, `delivered`, `failed`, `invalid`, `reverted`, `canceled` — collapse through `TONES` into five tones (`idle`, `running`, `attention`, `done`, `failed`), and through `DEFAULT_STATUS` into a default status phrase. So an agent reports its real state vocabulary and the UI does the collapsing, rather than every caller translating into a UI enum.

**`@status` overrides the default phrase**, so a caller can say "applying 3 of 7" where the table would say "applying…".

**`@tier` is density, not importance**: `step` is the quietest, `run` the loudest. That distinction is the territory's whole point — importance is carried by tone, containment by **Fold**'s indentation, and density by tier.

## Prior art

There is essentially no prior art. Radix, Web Awesome, React Spectrum and shadcn ship nothing for agent work, because the pattern is two years old. The recognisable references are product surfaces — Claude Code's tool-call rows, Cursor's composer steps, Devin's task list, GitHub Actions' step list — none of which is a component library.

So the interesting comparison is against the design laws this territory states, and they are worth quoting as the actual specification:

- **"Color never carries state alone: every state renders status text."** Every tone ships a phrase. There is no green-check-only row.
- **"The attention hue is reserved for 'a human must act now'."** One colour in the whole territory means "you". `ready`, `awaiting-approval`, `ask` and `input` all render `● needs you` — the same four words, so the phrase is learnable.
- **The glyph table has an empty string for `running`** — a running item shows a **Spinner**, not a character, because motion is the honest signal for in-progress and a static glyph is not.

Where it is thin: no error detail slot (a `failed` item shows "failed" and whatever you put in `<:default>`), no retry affordance, no timing/duration display, and no cancel. Composer, TaskRow, Recommendation and the thinking-trace rail exist in the design mirror and are not translated yet.

## Accessibility

No APG pattern. The relevant criteria are WCAG **1.4.1 Use of Colour**, **4.1.3 Status Messages** and **2.2.2**.

What is right, and it is unusually good for this kind of component:

- **State is always text.** `1.4.1` is satisfied by construction, not by a lint rule — the tone is a colour *and* a phrase, and the phrase is not optional. Most agent UIs fail exactly here.
- **The `● needs you` phrasing puts the meaning in words** rather than in the attention hue.
- **Progress uses ProgressBar** rather than a bespoke bar, inheriting its role and value properties.

Gaps, and the first is the big one:

- **State changes are not announced.** A WorkItem going from `running` to `awaiting-approval` — the single most important transition in the territory, because it means the user must act — changes text silently. There is no live region anywhere in this component. For a transcript that updates while the user reads it, a `role="status"` region (existing in the DOM *before* the change) reporting attention-state transitions is the highest-value addition to the whole territory. `assertive` for `attention` and `failed`, polite for the rest, mirroring **Alert**'s tone-driven role.
- **The glyph characters are content.** `·`, `●`, `✓`, `✕` sit in the DOM and are announced — "middle dot", "black circle", "check mark" — before or after the status phrase, which is noise since the phrase already carries the meaning. They should be `aria-hidden`.
- **The row has no grouping semantics.** Title, status, count and activity are sibling elements; a screen-reader user hears them as one run with no structure. `role="group"` with `aria-label` from the title, or a `<dl>`, would give it shape.
- **No accessible name distinguishes the tiers.** A `step` and a `run` announce identically.
- **`@activity` is a live-ish field** (what the agent is doing right now) with no live-region treatment.
- **Progress with no `aria-valuemin`, no accessible name and no `aria-valuetext`** — see **ProgressBar**'s own note; the gaps travel.
- The **Spinner** used for `running` carries `role="status"` and the label "Loading", so a running row may announce "Loading" alongside its own status phrase.

## Theming

Tone hues: the four semantic tokens plus the reserved attention hue (`--pretui-attention`), each driving ink and glyph. Surface and structure: `--card`, `--border`, `--muted-foreground`, `--foreground`, `--font-mono` (the verb voice), `--text-ui-*`. Progress: **ProgressBar**'s `--primary`/`--inset`.

**The attention hue is the one token a season must not reuse.** Its meaning in this territory is "a human must act now", and a season that also uses it for a decorative accent destroys the signal. Everything else in the territory is deliberately quiet so that one colour can be loud.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
