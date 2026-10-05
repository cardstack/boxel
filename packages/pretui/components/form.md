## What it is

The form host. It owns the commit gate, routes issues to fields, moves focus when it refuses, and yields a pre-bound API so nothing inside has to be threaded manually. Reach for it whenever more than two controls commit together, or whenever validation messages need to reach fields. For a single labelled control on a settings panel, **Field** is enough. For a read-only record view, **RecordDetail**.

**The architectural rule of the territory: the form never validates.** It is handed an already-computed `FormIssue[]` — produced by BXL guide rules authored as data and evaluated elsewhere — and it does three things with them: routes them to fields, gates the commit on the blocking ones, and moves focus when it refuses. Nothing here compiles, evaluates, splits or regex-matches anything. If you are looking for where to put a validation rule, it is not in this component.

## The contract

```
@mode? 'submit' | 'live' | 'record'   (default 'submit')
@issues?, @disabled?, @busy?
@onSubmit?, @onReset?, @onInvalidSubmit?(blockingIssues)
@focusOnInvalid? 'field' | 'summary' | 'none'   (default 'field')
@validationBehavior? 'aria' | 'native'          (default 'aria')
@label?, @labelledBy?
<:default as |form|>  <:footer as |form|>
```

**Three commit models, because a Boxel card autosaves and has no submit.** Wiring a classic submit form into a card edit view is precisely what sank the earlier attempt, so the modes are explicit:

- `submit` — commit on submit, validate on submit, focus the first error. Errors are **withheld** until the user tries to commit. React Spectrum's classic shape.
- `live` — commit per field immediately; issues are ambient advice and **never a gate**. Submitting does not refuse and does not move focus. The card-autosave shape.
- `record` — commit per field inline, saved as a batch; validate per field plus a summary. The `<:footer>` docks and its save goes through the same gate as submit mode. The SLDS record-detail shape.

**`@validationBehavior='aria'` puts `novalidate` on the `<form>`.** Same switch, same names as React Spectrum. Since the kit owns the messaging, the browser must not also pop its own bubbles over the fields.

**The yielded API is pre-curried.** `form.Field`, `form.Layout`, `form.Section`, `form.Summary` and `form.Error` are contextual components already bound to this form's context, alongside `dirty`, `pristine`, `submitted`, `blockingIssues`, `unroutedIssues`, `submit`, `reset` and `markDirty`. Nothing inside a form has to be handed the form by hand — though every one of those components also accepts it directly, which is what makes them usable stand-alone.

Dirty tracking rides the form's own bubbled `input`/`change`, so a caller never has to remember to call `markDirty` — and `markDirty` is yielded anyway for controls that commit without emitting either.

One authoring trap, documented in the source: **using `<:footer>` means the body must be an explicit `<:default>`.** Mixing loose content with named blocks fails the realm transpile.

## Prior art

Two references, split by concern. **React Spectrum / React Aria** supplies the semantics: the `validationBehavior` switch, `FieldError`, focus-the-first-invalid-field on submit, `aria-describedby` ordering, required marking. **Salesforce Lightning Design System** supplies the layout and enterprise patterns: `form-element` with its `_stacked`/`_horizontal`/`_readonly`/`__static`/`__help` modifiers, `form-layout`, `docked-form-footer`, `record-detail`. **Radix `Form`** is the third comparison — `Field name` auto-association, `Message match` over native `ValidityState`, and focus-to-first-invalid on submit — and it is the closest in spirit, though it validates and Pretui deliberately does not.

Where Pretui improves on both, concretely:

- **SLDS's docked form footer is `position: fixed; width: 100%` against the viewport** — inside a card pane it escapes its pane and lands over the host chrome. Pretui's is `position: sticky` inside the form.
- **SLDS breaks form-layout columns on `@media (min-width: 48em)`** — the viewport, not the pane — so a two-column form in a 320px side panel of a 1600px window stays two columns and shreds. Pretui uses container queries.
- **Neither library ships an error summary that can prove nothing was dropped.** `ErrorSummary` lists every issue and explicitly marks the ones whose `targetPath` matched no rendered field.
- **Neither has severity tiers on a field message.** SLDS has one flat error style; React Spectrum's `FieldError` is errors-only. Pretui's is severity-aware and **fails closed** — an unrecognised severity renders as an error and blocks.
- **`live` mode has no analogue in either.** It exists because autosaving cards are the primary consumer.

## Accessibility

No APG pattern — a form is wiring. The governing criteria are WCAG **3.3.1 Error Identification**, **3.3.2 Labels or Instructions**, **3.3.3 Error Suggestion** and **3.3.4 Error Prevention**.

What is right, and is the point of the component:

- **Focus lands somewhere useful on a refused commit.** `focusInvalid()` prefers the first invalid field *in real document order* — sorted by `compareDocumentPosition`, not by registration order, because conditionals and re-renders break that — then falls back to the summary, then to whatever the summary would have pointed at. `@focusOnInvalid='summary'` switches to the GOV.UK behaviour.
- **Focus can reach a control inside a collapsed section.** `reveal()` walks up through every `[data-pretui-form-section]` ancestor, calls its registered open callback *and* clears the `hidden` attribute on the spot so focus lands in this tick rather than after the next render. A user is never asked to fix something they cannot see.
- `aria-busy` while `@busy`; `aria-label`/`aria-labelledby` for the form's name.
- The deferred claim publish is a **microtask**, not a timer — the realm's no-`setTimeout` law holds — which sidesteps Ember's backtracking-rerender assertion when fields register mid-render, and coalesces a batch into one flush.

Gaps:

- **`<form>` gets no `role="form"` landmark.** A `<form>` is only a landmark when it has an accessible name — so passing `@label` or `@labelledBy` is not optional if you want it findable by landmark navigation, and nothing warns when both are absent.
- **`@busy` sets `aria-busy` but announces nothing.** A submit in flight is silent to a screen-reader user; pair it with a live region.
- **A refused submit announces only via focus movement.** That is deliberate (see ErrorSummary's live-region note) and matches GOV.UK, but it means `@focusOnInvalid='none'` produces a submit that silently does nothing. Do not use it without another announcement channel.
- `@disabled` travels through the context to every field, which is correct, but it does not disable the footer's own buttons — the caller owns those.

## Theming

The `<form>` element itself carries `data-mode`, `data-dirty`, `data-submitted` and `data-busy` for season hooks, and consumes the shared layout tokens (`--space-*`). Nearly all visual tokens belong to the child components — **FormField**, **FormLayout**, **FormSection**, **ErrorSummary**, **FormFooter** — which is the intended shape: the host is behaviour, the children are dress.

Note the invalid and readonly dresses reach caller-supplied controls **through the inherited token channel** (`--field`, `--input`), not through `:deep()` or `:global()`. That is why they work on Input, Textarea, Select and anything else that reads the Pretui control tokens, and it is why a custom control that reads those tokens gets validation styling for free.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| React | Pretui |
| --- | --- |
| `<Form>` / react-hook-form / Aria Form | this tile |
| FormField / Field / FormControl | **FormField** / **Field** |
| FormMessage / errorMessage | **FieldError** |
| FormDescription | help slot |
| Fieldset / FormSection | **FormSection** / **Fieldset** stub |
| zod resolver / validation | caller — Form routes issues |

- [ ] Accept `onSubmit` prevention defaults agents expect (`event.preventDefault`).
