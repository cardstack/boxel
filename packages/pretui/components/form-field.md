## What it is

One field in a form: label, control, description, help, required marking, and the issue messages routed to it. This is the workhorse of the forms territory and the component that makes the wiring impossible to forget. Use it for anything inside a **Form**; use **Field** only for a labelled control on a surface with no form and no validation. For a read-only record row, `@static={{true}}` here is the same component rather than a different one.

## The contract

```
@label?, @path?, @value?, @description?, @help?
@required?, @hideRequiredIndicator?, @disabled?, @readonly?, @static?, @invalid?
@issues?, @layout? ('stacked'|'horizontal'), @span?, @controlId?, @labelHidden?
@reserveMessageSpace? (true), @showAdvisory? (true), @showRuleId?, @announceErrors?
@emptyText? ('—'), @form?, @section?
<:control as |ctx|>  <:static>  <:description>  <:after>
```

**`@path` is a BXL label path and it is matched as a whole string.** Scalars use the field label, quoted when it contains spaces (`Total`, `"Approver Email"`); rows use a predicate path (`"Line Item"[SKU = "COPY-04"].Quantity`). Routing compares the entire string and **never splits on `.`**, because predicate paths legitimately contain dots, brackets, quotes and spaces. Getting this wrong is the classic enterprise-forms bug and the source says so explicitly.

**`<:control>` receives a `FormControlContext` carrying everything the control needs to wire itself**: `id`, `labelId`, `describedBy` (description ids then error ids, space-joined, `undefined` when there is nothing to describe), `descriptionId`, `errorId`, `invalid`, `required`, `disabled`, `readonly`, `path` and `markDirty`. The control cannot be wired wrongly because the field computed the whole chain and handed it over.

**`@value` is a plain scalar, not a FieldDef.** A form field here is a value and a path — which is the whole point of building this in a component library first. Anything richer goes in `<:static>`.

**`@readonly` and `@disabled` render differently on purpose.** Readonly flattens the chrome (`--field` and `--input` go transparent) while the value stays selectable and the control stays focusable; disabled dims. "You may not change this" and "this is not available right now" are different sentences.

The field registers itself with the form from its constructor and unregisters in `willDestroy`, publishing `{ rootId, controlId, path }` so focus routing can find it.

## Prior art

**React Spectrum / React Aria** supplies the semantics — `useField`'s id generation, the description-then-error `aria-describedby` order, required marking. **SLDS `form-element`** supplies the shape: `_stacked` / `_horizontal` / `_readonly` / `__static` / `__help` / `__icon` / `__undo`, all of which map onto args or blocks here.

Three improvements over SLDS, each concrete:

1. **SLDS's field-level help tooltip hardcodes `id="help"`** and only renders the bubble while shown — so every field on a page points at the same id, and the reference dangles whenever the tooltip is hidden. Pretui's help ids are guid-unique and the described text is **always in the DOM**.
2. **SLDS computes an `errorId` but never wires `aria-describedby` itself**, and its own examples routinely omit it. FormField computes the whole chain and *yields* it, so the wiring cannot be forgotten.
3. **SLDS's required marker is an `aria-hidden` `abbr`**, so required-ness only reaches assistive tech if the caller remembered `required` on the input. Pretui adds a visually-hidden "(required)" **inside the label**, so the accessible name always carries it — belt and braces, one authoring step.

And one over React Spectrum: its `FieldError` is errors-only and unstyled by severity, while Pretui's messages are severity-tiered and fail closed.

## Accessibility

No APG pattern; governed by WCAG **3.3.1**, **3.3.2**, **3.3.3** and **4.1.2**. This is the best-wired component in the kit.

What is right:

- `<label for>` with a matching `labelId`, or a `<span>` in static display.
- `describedBy` is **description first, then errors**, matching React Spectrum's order, and is `undefined` rather than an empty string when there is nothing — no dangling idrefs, which is exactly what `useSlotId` exists to prevent.
- `invalid` in the control context is driven by *blocking* issues only, so the caller sets `aria-invalid` from a value that already respects severity.
- The required marking reaches the accessible name, not just the pixels.
- **The live-region policy is deliberate and correct.** `role="alert"` interrupts; a field message that re-renders on every keystroke must never be a live region or a screen-reader user is talked over while typing. So `announce` is opt-in and FormField only turns it on for `record` mode, where an error is the result of one discrete commit. In `submit` mode the **ErrorSummary** announces by taking focus; in `live` mode nothing announces, and the message is still read whenever the field is focused because its id is already in `describedBy`. Most kits get this wrong in one direction or the other.
- `@reserveMessageSpace` (default true) keeps side-by-side fields from jumping when an error appears.

Gaps and cautions:

- **The wiring is yielded, not applied.** If `<:control>` ignores `ctx.describedBy` or `ctx.invalid`, nothing is wired and nothing warns. The component removes the *excuse* for forgetting, not the possibility. A dev-mode assertion that the yielded `id` was consumed would close it.
- **The help affordance is a Tooltip**, which inherits Tooltip's gaps — no Escape dismissal and `pointer-events: none`, both WCAG 1.4.13 failures. Because the help text is always in the DOM and referenced by id, the *semantic* path is fine; the pointer path is not.
- `@labelHidden` keeps the label in the accessible tree, which is correct, but a visually hidden label plus a placeholder is still a WCAG 3.3.2 smell for sighted users.
- `@static` produces no control at all, so `describedBy` describes nothing focusable — expected, but do not pass `@required` alongside it.
- The `emptyText` default `'—'` is announced literally by some screen readers as "em dash"; consider a visually-hidden "not set" for record views.

## Theming

`--field` and `--input` (repointed to `transparent` in readonly, and to a `--destructive` mix when invalid — the token channel is how the dress reaches caller-supplied controls without `:deep()`), `--foreground`, `--muted-foreground`, `--destructive`, `--pretui-field-disabled-opacity` (default 0.5), `--inset`, `--border`, `--pretui-shadow-hairline`, plus the **Label** component's mono eyebrow tokens and **Token**'s tokens when `@showRuleId` is on.

`data-readonly`, `data-disabled`, `data-static` and the layout/span attributes are all reflected on the root, so a season can hook any of them. Because the invalid dress travels by token, a custom control that reads `--field`/`--input` gets error styling for free — and one that hard-codes its colours will silently opt out.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| shadcn Field / Aria / Chakra / SLDS | Pretui FormField |
| --- | --- |
| label | label slot / @label |
| description / helperText | help slot |
| errorMessage / FormMessage | **FieldError** |
| isRequired / isInvalid / isDisabled | @required / @invalid / @disabled |
| htmlFor / labelledby | already wired |

- [ ] Accept `errorMessage` and `description` as string-arg sugar for the slots.
