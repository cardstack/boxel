## What it is

The boolean argument row of a **FreestyleUsage** page — `Args.Bool`. Docs lens: a table row. Property lens: a **Switch** bound to the example. Use it for any boolean argument. For a string, **UsageString**; a number, **UsageNumber**; anything without a manipulable value, **UsageArgument**.

## The contract

```
@mode? 'doc' | 'prop'
@name?, @description?, @defaultValue?, @required?, @optional?, @hideControls?
@value?: boolean
@onInput?(value: boolean)
```

**The control is a Switch, not a Checkbox**, and that is the correct choice for this context: a knob takes effect immediately with no save step, which is exactly the distinction between the two components in this kit. A Checkbox here would imply a form.

**`@mode` is the lens.** The `<:api>` block is authored once and rendered twice — property list (`prop`) and API table (`doc`).

Note the signature: `@value?: boolean` with no `null`, unlike **UsageString** (`string | null`) and **UsageNumber** (`number | null`). A boolean argument is on or off; an unset boolean is `false` from the component's point of view, which is honest for Glimmer args where an omitted boolean is falsy.

## Prior art

**ember-freestyle's `Freestyle::Usage::Bool`** is the upstream; the invocation surface is verbatim.

**Storybook's `boolean` control** is the analogue and renders a toggle. Same shape, same idea.

The Pretui port's improvement is the same one that runs through this family: **the control is the kit's own Switch**, so the documentation surface dogfoods the components it documents. A regression in Switch is visible on every usage page in the catalogue before it is visible in a test.

Where it is behind Storybook: no tri-state for arguments that are meaningfully "unset" versus "false" — which matters more than it sounds, because a Glimmer component that distinguishes `@foo={{false}}` from an omitted `@foo` cannot be demonstrated here.

## Accessibility

No pattern of its own; it renders a **Switch** plus a table row, and inherits Switch's contract — `role="switch"`, `aria-checked` `'true'`/`'false'` (never `'mixed'`, which the Switch pattern forbids), Space and Enter both activating.

Gaps, and the first is inherited and significant in this context:

- **Switch has no accessible name of its own.** It takes `@controlId` so a wrapper can supply a `<label for>`, and the property rail's label must actually do that. If it does not, a property list of eight boolean knobs announces as eight switches called nothing. **This is the most likely real failure on a usage page** and it is worth checking directly — Switch is visually self-evident and the omission is easy to miss.
- **Switch defines no focus-visible ring** (see its own note), so keyboard users tabbing the property list may not see where they are.
- **Switch's 30×18 track is below WCAG 2.5.8's 24×24 minimum** on the short axis; in a dense property list there is no larger label row to compensate the way there is in a form.
- **Toggling re-renders the example silently** — no live region, no confirmation.
- **`@required` must reach the accessible name** in the docs lens, not only render an asterisk.
- **The label must not change with state** (an APG Switch requirement): the rail should read `@disabled`, not "Disabled: on".

## Theming

**Switch**'s tokens for the control (`--pretui-control-border` / `--line-strong` for the off track, `--primary` for on, `--card` for the thumb, `--shadow-ink-mid`, and the snap duration/easing), **Table**'s for the doc row, plus the property rail's label voice.

Nothing of its own. The one thing to check per season is Switch's on/off distinction at this size: a property list shows many switches at once, most of them off, and if `--primary` and `--line-strong` are close in luminance the on ones do not stand out — which is exactly the reading task this surface exists for.
