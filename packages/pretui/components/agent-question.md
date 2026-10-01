## What it is

The ASK verb: a question from the agent, option pills to answer it, a free-text fallback, and a quiet settled line once answered. Use it when an agent needs a decision to continue. If it needs *approval* of work already staged, **ApprovalFooter**. If it is reporting rather than asking, **WorkItem** or **ResultCard**. If the question is a form, it is a form — use **Form**.

## The contract

```
@question: string   (required)
@options?: string[]
@answered?, @onAnswer?(answer: string)
```

**Options and free text coexist.** The pills are shortcuts, not a closed set — the input accepts anything and commits on Enter. That is the right model for an agent conversation, where the agent's guesses at likely answers should not constrain the human.

**It settles.** Once answered, the component collapses to a quiet answered line rather than staying open. `@answered` seeds that state, so a transcript re-rendered from history shows settled questions settled. This is the territory's general shape — attention states are loud, resolved states recede — and it is what keeps a long transcript readable.

`@onAnswer` fires for both paths; the caller cannot tell a pill from typed text, which is deliberate (the answer is the answer).

## Prior art

No component kit has this. The references are chat products: Slack's interactive message buttons, ChatGPT's suggested replies, and the general "quick reply" pattern from messaging platforms.

The decisions worth comparing:

- **Quick-reply chips in messaging platforms are usually a closed set** — you tap one or you type something the bot cannot parse. Here the pills and the free-text field are the same commitment, and both settle the question.
- **Most chat UIs leave answered prompts fully rendered**, so scrolling back through a conversation means scrolling past dozens of dead button rows. Settling to a quiet line is a better long-transcript behaviour and is the same instinct **Fold** and **CollapsedTurn** apply elsewhere in this territory.

Where it is thin: no multi-select answers, no typed answer validation, no "I don't know" / decline path, and no timeout or default. An agent blocked on a question that never gets answered has no expressed fallback.

## Accessibility

No APG pattern; the pieces are a group of buttons plus a text field.

Gaps, and they are the same shape as the rest of the territory — the semantics are fine, the *announcement* is missing:

- **The question's arrival is not announced.** An agent asking a question mid-run is precisely a status message that must reach the user (**WCAG 4.1.3**), and there is no live region. A screen-reader user reading a transcript will not know the agent has stopped and is waiting. This is the same gap **ApprovalFooter** has and it is the territory's central accessibility problem.
- **The question is not programmatically the label of the answer controls.** The pills and the input are siblings of the question text, so a screen-reader user tabbing to the input hears an unlabelled text field. `aria-labelledby` from the input to the question, and `role="group"` with the same, would fix both.
- **The option pills are plain buttons with no group semantics.** For a single-choice answer the accurate model is `role="radiogroup"` — the same correction **FilterChips** and **SegmentedControl** need — though the free-text escape complicates it; a labelled `role="group"` is the minimum.
- **Commit-on-Enter is undiscoverable.** There is no visible submit button and no hint that Enter commits. For keyboard and screen-reader users that is a **WCAG 3.3.2 Labels or Instructions** gap; a visually-hidden instruction or a real submit button would close it.
- **The settled transition is silent**, and the answered line's relationship to the original question is visual.
- **No `aria-live` on the settled state** means a user who answers by pill gets no confirmation that their answer registered.
- Pill target sizes should be checked against WCAG **2.5.8**'s 24×24 minimum.

## Theming

Attention tone for the unanswered state (the territory's reserved "a human must act now" hue), receding to `--muted-foreground` once settled. Pills carry **Chip**- or **Button**-family dress; the input carries the kit's control tokens (`--field`, `--input`, `--primary`, `--control-h`, `--radius`).

The unanswered-to-settled contrast is the thing a season must get right: the question must be visibly *pending* in a scroll-back of forty transcript rows, and visibly *done* afterwards. If a season flattens that difference, a long transcript stops showing where the agent is blocked — which is the one thing the territory exists to make obvious.
