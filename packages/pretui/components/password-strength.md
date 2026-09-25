## What it is

A password strength meter: a five-step score with a label, the estimator's warning and suggestions, and an optional crack-time aside.

## The contract

```
@score?      — zxcvbn score 0…4. Clamped; anything unusable reads as 0. Leave it
               UNDEFINED for "not estimated yet"
@warning?    — the estimator's headline warning, if it produced one
@suggestions? — the estimator's actionable suggestions, if it produced any
@crackTime?  — humanised crack time, shown as a quiet aside when supplied
@labels?     — replace the five default labels, for localisation or a house voice
@announcePrefix? — what the live region says before the label
@busy?       — true while an estimate is in flight
@hideWhenEmpty? — render nothing until there is something to say. Default true;
               pass false to reserve the row's height from first paint
```

**Undefined and 0 are different, and the meter says so.** "Not estimated yet" reads as exactly that rather than lying at the bottom of the scale — which is what a meter defaulting to zero tells someone who has typed nothing.

**`@busy` greys the meter and silences the live region**, so nothing is announced mid-flight. A meter that announces every intermediate estimate as the estimator catches up is unusable.

**It does not estimate.** The score, warning and suggestions all come from the caller's estimator — this component displays a judgement, it does not make one.

**`@hideWhenEmpty={{false}}` reserves the height**, which is the right choice when the meter sits in a form that should not jump as it appears.

## Prior art

The zxcvbn-backed meters in sign-up forms.

Where Pretui is better: the undefined/zero distinction, the busy silence, and suggestions being first-class rather than a tooltip. Most meters are a coloured bar and nothing else, which tells someone their password is bad without telling them how to fix it.

Where it is thinner: no estimator bundled — deliberately, since zxcvbn is large — no policy enforcement, and no per-rule checklist.

## Accessibility

- **The strength is a word, not a colour.** The label is what carries the judgement; the bar is the visual shorthand.
- **The live region announces on change with `@announcePrefix`**, so a reader typing is told when the assessment moves rather than having to go looking.
- **`@busy` keeping the region silent is the detail that makes the live region tolerable** — announcing every intermediate state would make it the loudest thing on the page.
- **Suggestions are text, and they are the useful part.** A meter that says "weak" and nothing else is an obstacle; one that says what to change is help.
- **Colour reinforces the label** and never replaces it, so the meter works in greyscale.

## Theming

The five steps take the kit's semantic hues, and the meter's geometry the shared control tokens.

Using the semantic scale rather than a bespoke red-to-green means a season's danger and success colours govern the ends — and a season that has chosen accessible versions of those gets an accessible meter for free.
