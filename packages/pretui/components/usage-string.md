## What it is

The string argument row of a **FreestyleUsage** page — `Args.String`. In the docs lens it is a table row; in the property lens it is a live control bound to the example. With `@options` it renders a **Select**; without, an **Input**. Use it for any string-valued argument. For a boolean, **UsageBool**; a number, **UsageNumber**; a list, **UsageArray**; anything structural, **UsageObject** or **UsageArgument**.

## The contract

```
@mode? 'doc' | 'prop'
@name?, @description?, @defaultValue?, @required?, @optional?, @hideControls?
@value?: string | null
@options?: string[]
@onInput?(value: string)
```

**`@options` turning an Input into a Select is the whole design decision.** A string argument with a known set of values is an enum in everything but the type system, and giving it a free-text box invites typos that silently produce a broken example. `selectOptions` maps the plain string array into the `{ value, label }` shape **Select** wants, so a page author writes `@options={{array 'sm' 'md' 'lg'}}` and gets a proper picker.

**`@mode` is the lens.** The `<:api>` block is authored once and rendered twice — as the right-hand property list (`prop`) and as the API table (`doc`) below. This component knows both.

`@hideControls` suppresses the knob while keeping the documentation, for an argument that is documented but not safely manipulable live.

## Prior art

**ember-freestyle's `Freestyle::Usage::String`** is the upstream; the invocation surface is verbatim.

**Storybook's `text` and `select` controls** are the analogue, and they are chosen separately in `argTypes` — you declare `control: { type: 'select' }` and supply `options`. Here supplying `options` _is_ the declaration, which is one fewer thing to get wrong and one fewer way for a control's type and its options to disagree.

Where the Pretui port improves on the freestyle upstream: **the control is the kit's own Select or Input**, so the knob is the same component the page may be documenting. A usage page for **Select** drives itself with a Select — which is a genuine forcing function, since a broken control breaks its own documentation immediately and visibly.

Where it is behind Storybook: no `radio`/`inline-radio` presentation for small option sets (**SegmentedControl** or **RadioGroup** would be the natural choices and neither is wired), no `null`-vs-empty-string distinction in the UI despite the type admitting both, and no validation.

## Accessibility

No pattern of its own; it renders one of two kit controls plus a table row.

Gaps:

- **The knob's label is the property-row rail, not a `<label for>`.** Verify the label and the control are actually associated — a property list of unlabelled Inputs and Selects is the most likely failure here, and neither **Input** nor **Select** generates its own name. Both accept `@controlId`, so the fix is available.
- **`@required` must reach the accessible name**, not only render an asterisk — the fix **FormField** already made in the forms territory.
- **Changing a knob re-renders the example silently.** No live region announces the effect, so a screen-reader user changing `@size` from `md` to `lg` gets no confirmation that anything happened. This belongs to **FreestyleUsage** but is felt here.
- **Free-text mode has no format guidance.** A string argument expecting a CSS length or an ISO date offers a bare Input with no hint (**WCAG 3.3.2**), and `@description` lives in the _other_ lens — so the docs table has the explanation and the knob does not.
- **The two lenses are not linked.** A reader in the property list has no route to the row documenting the same argument.
- **`@options` with many values** produces a Select that auto-enables search past seven — inherited, and good.

## Theming

**Select** and **Input** token sets for the control, **Table**'s for the doc row, plus the property rail's label voice (`--muted-foreground`, the mono eyebrow treatment) and **Token**'s for the type and default value.

Nothing of its own. Because the property list is dense and its labels are small, a season should verify the rail's ink against `--card` at the eyebrow size — this is a surface read closely by people comparing values, and it is one of the smallest text sizes in the kit.
