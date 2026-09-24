## What it is

A control fused with accessories — a prefix, a suffix, a button, a select — sharing one hairline so the assembly reads as a single field. Use it for `https://` before a path, `.00` after a price, a unit **Select** after a number, a "Go" **Button** after a query. If the accessory is an icon inside the field, most of the typed inputs already have one (**SearchInput**'s clear, **PasswordInput**'s reveal). If you need two independent controls side by side, that is layout, not an input group.

## The contract

```
@value?, @placeholder?, @type?, @disabled?, @controlId?, @onInput?(value)
@invalid?          — sugar for @state='invalid'
@state?            — boxel's validation-state enum; wins over @invalid
@errorMessage?, @helperText?, @required?, @readonly?, @autocomplete?
<:default as |Controls, Accessories, group|>
<:before as |Accessories, group|>   <:after as |Accessories, group|>
<:start>   <:end>
```

**There are two modes and the block you use selects them.** With no default block, the component renders boxel-ui's built-in input and `<:start>`/`<:end>` wrap your content in an `Accessories.Text`. With a default block, **boxel skips its built-in input entirely** and you supply the controls yourself from the yielded `Controls` (`Input`, `Textarea`) and `Accessories` (`Button`, `IconButton`, `Select`, `Text`) hashes. That is a genuine mode switch, not a progressive enhancement, and mixing the two is the main way to get confused output.

**`<:start>`/`<:end>` are sugar over `<:before>`/`<:after>`.** The short forms wrap in `Accessories.Text` for you; the long forms hand you the `Accessories` hash so you can place a Button or a Select. Use the short ones for static affixes and the long ones for anything interactive.

**`@state` wins over `@invalid`**, with `@invalid` kept as sugar. Two args for one concept is the cost of preserving the Pretui signature over boxel's richer enum.

## Prior art

A **thin runtime wrap of boxel-ui's `InputGroup`**, re-dressed through the semantic-token + `--boxel-*` channel with no CSS reaching boxel markup.

**Web Awesome** has no input group; `wa-input` takes `start`/`end` slots for icons and nothing else — no buttons, no selects, no shared hairline across separate controls. **Radix** has none. **React Spectrum** has none. **shadcn** has none. **Bootstrap's `input-group`** is the canonical reference and the ancestor of this shape.

So Pretui/boxel-ui is genuinely ahead of the modern kits here: the fused-accessory pattern is common in enterprise UI and none of Radix, Spectrum or Web Awesome ship it, leaving teams to fake it with negative margins and `border-radius: 0` overrides. Having the shared hairline solved once, with correct end-cap rounding and focus-ring handling across the whole assembly, is real value.

Where it is behind Bootstrap's version: no size axis, and the two-mode API is more surface than Bootstrap's "put things in a div" approach. Where the whole thing is awkward: **the yielded hashes are `any`-typed** — boxel-ui does not export the accessory signatures — so `Controls.Input` and `Accessories.Button` have no autocompletion and no arg checking. The source casts them explicitly (`asControls`, `asAccessories`) and that cast is where type safety stops.

## Accessibility

No APG pattern; it is a labelled control plus decorations, governed by WCAG **1.3.1**, **3.3.2** and **4.1.2**.

Gaps, and the affix one is the interesting one:

- **Static affixes are announced as loose text.** A `<:start>` reading `https://` becomes text adjacent to the input, not part of its label or description. So a screen-reader user hears "https colon slash slash, edit text, Website" and must infer the relationship — or, worse, does not hear it at all depending on reading mode. The correct treatment is to include the affix in the field's `aria-describedby`, and nothing does that. If the affix carries meaning the user needs, put it in **FormField**'s `@description` as well.
- **Interactive accessories join the tab order in DOM order**, which is right — a "Go" Button after a field should be the next tab stop.
- **A trailing Button's relationship to the field is implicit.** An `IconButton` at the end of a group has its own `aria-label` ("Search") but nothing connects it to the input it acts on. For a single group that is inferable; on a page with three, less so.
- **The ARIA wiring for `@errorMessage`/`@helperText` is boxel-ui's** — verify against your version whether they reach `aria-describedby`. The ecosystem's settled position is `aria-describedby` over `aria-errormessage`, which VoiceOver and NVDA still handle poorly.
- **No accessible name of its own.** `@controlId` lets **Field**/**FormField** wire a `<label for>`; outside those, pass `aria-label`.
- **The focus ring is on the inner control, not the assembly**, in most implementations of this pattern — so a keyboard user sees a ring around part of a box that reads as one control. Check what your boxel-ui version does; a ring around the whole group is the better treatment and is what Bootstrap eventually adopted.
- **`@disabled` dims the whole group** via `data-disabled`; verify the accessories are actually disabled and not merely dimmed.

## Theming

Consumed: `--field`, `--input`, `--primary` (focus ring via `--ring`), `--ink-3`, `--control-h`, `--radius`, `--text-ui-md`, `--track-ui`, plus **Button**/**IconButton**/**Select** tokens for whatever accessories you place.

Forwarded into boxel-ui through the `--boxel-*` channel. `data-state` (the validation enum) and `data-disabled` are reflected on the wrapper, so a season can dress both without reaching inside.

The shared hairline is the thing to check per season: because the group's edge and its internal dividers both come from `--input`, a season with a strong input colour will see the dividers as prominently as the outline, and the assembly stops reading as one control. A season that wants quieter dividers has no separate token for them — that is the main theming limitation here.
