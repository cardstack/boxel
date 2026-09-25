## What it is

The CSS-variable row of a **FreestyleUsage** page — `Css.Basic`, yielded by the `<:cssVars>` block. It documents a custom property the component reads, and in the property lens lets you change it live and watch the example re-dress. Use it for every token a component consumes. For component _arguments_, the `Args.*` family (**UsageString**, **UsageBool**, **UsageNumber**, **UsageArray**, **UsageObject**, **UsageArgument**).

## The contract

```
@mode? 'doc' | 'prop'
@name?, @description?, @defaultValue?
@value?: string | null
```

**This is the only Usage component whose subject is not an argument**, and it has its own block (`<:cssVars>`) for that reason. A component's theming surface is a real part of its contract — arguably the part most likely to be undocumented — and giving it a first-class row means a usage page can state which tokens matter rather than leaving a reader to grep the stylesheet.

**The name prints bare, with no sigil**, because a custom-property name already carries `--`. The sibling `Args.*` rows print `@name`, and yields print `{{name}}` — three visual forms so a reader can tell an argument from a block from a token at a glance, without the page author annotating anything.

**`@value` is `string | null`** — a CSS value is text, and `null` means "not overridden", which is meaningfully different from an empty string.

Note there is no required/optional pair here, unlike every other row in the family: a token is never required.

## Prior art

**ember-freestyle's `Freestyle::Usage::CssVariable`** is the upstream; the invocation surface is verbatim, including the `<:cssVars as |Css|>` block name.

**Storybook has no equivalent.** Its controls are props; CSS custom properties are documented, if at all, in an MDX page a human wrote and nobody keeps current. **Web Awesome's** docs list CSS custom properties and CSS parts in a static table per component — good documentation, not live. **Radix** documents its `--radix-*` output properties in prose.

So the live-token knob is genuinely uncommon, and it is the right shape for a design system: **the surface that documents a component also lets you re-theme it in place.** Combined with **ThemeFrame**, a reader can switch season _and_ poke an individual token, which is a much faster way to understand a component's theming surface than reading a table.

Where it is thin: the value is free text, so there is no colour picker for a colour token, no length control for a dimension, and no validation — typing `blue!` silently produces an invalid declaration that CSS drops. **ColorPicker** and **Slider** are both in the kit and neither is wired.

## Accessibility

No pattern of its own; it renders a text control plus a table row.

Gaps:

- **The control is free text with no format guidance.** A token expecting a colour, a length, a duration and a shadow all get the same bare **Input** with no hint — a **WCAG 3.3.2** gap, and one that bites here because CSS values are exactly the kind of syntax people get wrong.
- **An invalid value fails silently.** CSS drops a bad declaration, so the example simply does not change and nothing says why — no `aria-invalid`, no message (**WCAG 3.3.1**). That is arguably the worst failure mode in the family: the knob appears to do nothing.
- **The control's accessible name** depends on the property rail wiring a `<label for>`; **Input** generates none of its own.
- **Changing a token re-dresses the example silently** — no live region.
- **Token names are punctuation-heavy** (`--pretui-shadow-overlay`) and are announced character by character or as run-together words depending on the reader. Nothing can be done about that, but it argues for `@description` carrying a human phrase.
- **Changing a colour token can change the example's contrast**, and there is no contrast readout — a reader exploring theme values gets no signal that a combination has become unreadable. A computed ratio would be the single most valuable addition to this component, and it is the same gap **ColorPicker** has.

## Theming

**Input**'s tokens for the control, **Table**'s for the doc row, and the property rail's label voice. The default-value cell should use **Token**'s mono treatment — a CSS value is a machine value, Law 3.

Nothing of its own, which is fitting for the component whose subject _is_ theming. Note the recursion worth being aware of: this row can change a token that the row itself reads, so a reader overriding `--muted-foreground` re-dresses the property list they are typing into.
