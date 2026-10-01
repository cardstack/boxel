## What it is

One trigger, one disclosed region. Use it for the single "show more" a page needs — advanced options under a form, grading notes under a lot, a long caption folded away. If several sections belong together and open independently, use **Accordion**, which is a stack of these with the boxel-ui engine underneath. If the region is a receipt of agent work with a rail down the side, that is **Fold**. If the collapsible group lives inside an inspector and needs a titled header row, use **PanelSection**. If nothing needs to animate and no state needs to survive, a native `<details>` is enough.

## The contract

```
@open?           — controlled state; leave undefined for the uncontrolled half
@defaultOpen?    — uncontrolled initial state (default false)
@onOpenChange?   — fires on every toggle with the next state, controlled or not
@label?          — trigger text; sugar for <:trigger>
@disabled?       — announced and styled as disabled, still focusable
@size?           — the kit size scale (xs · s · m · l · xl, default m)
@hideCaret?      — drop the rotating chevron
<:trigger as |open|>   — wins over @label; yielded the current state
<:default>             — the disclosed region
```

**Hybrid state, one callback.** With `@open` undefined the component keeps its own state and `@defaultOpen` seeds it. With `@open` set the component never moves itself — it reports the requested state through `@onOpenChange` and waits for the parent to change the arg. The callback fires in both modes, so a consumer that only wants to count toggles need not choose.

**The region is never unmounted.** Closed content stays in the DOM; the fold's `visibility` takes it out of the tab order and the accessibility tree, on a delayed step so it only flips once the collapse has finished. An input inside keeps its value across a toggle, and the animation is the height itself — a grid row track going from `0fr` to `1fr` — so nothing is measured and nothing goes stale when the content reflows mid-transition.

**Disabled is `aria-disabled`, not the attribute.** The trigger stays focusable and announced; the click handler is the gate, and the callback does not fire.

**State attributes are strings both ways.** `data-state='open' | 'closed'` on the root and the trigger, `data-disabled='true' | 'false'` on the root, so a consumer writes one selector idiom.

## Prior art

**Radix `Collapsible`** (and **shadcn**, which re-exports it) is the reference agents type from memory: `open` / `defaultOpen` / `onOpenChange` / `disabled`, a `Trigger` and a `Content`. Radix animates by publishing `--radix-collapsible-content-height`, which it obtains by temporarily zeroing the element's own transition and reading `getBoundingClientRect()` — a pixel value that is stale the moment the content reflows. Its default content mode renders `{open && children}`, so every open remounts the region and uncontrolled inputs reset; the `forceMount` mode you need for any animation leaves focusable content reachable behind a clipped box. Its `data-state` is a string while `data-disabled` is a bare presence attribute. **Chakra `Collapsible`** has the same shape plus `unmountOnExit`. **React Aria `Disclosure`** spells the state `isExpanded` / `onExpandedChange` and provides the button and panel roles. **Mantine `Collapse`** and **MUI `Collapse`** are animation wrappers only — no trigger, no ARIA.

Where this is better: the height animation is the kit's expand grammar with no measurement and no JS; content stays mounted and is genuinely removed from the tab order when closed; the trigger stays focusable when disabled; the rotating caret every Radix consumer hand-builds off `data-state` is built in and switchable; and reduced motion lands on the end state rather than a frozen midpoint, which none of Radix, shadcn or the shadcn registry guard.

Where it is thinner: there is no `unmountOnExit` — the region is always mounted, by design, and a consumer that needs teardown wraps the content in its own `{{#if}}`. There is no `isExpanded` / `onExpandedChange` spelling. The trigger is always a button with the label inside it; a consumer who wants a heading around it has to supply the heading and put the whole component in it.

## Accessibility

Governing pattern: APG **Disclosure**. The pattern requires a button with `aria-expanded`, optionally `aria-controls` pointing at the region, Enter and Space to toggle. All three are here and asserted.

- **The trigger is a native `<button type='button'>`** carrying `aria-expanded='true' | 'false'` and `aria-controls` pointing at the region's id. `aria-controls` is present while closed as well as open — Radix omits it when closed because its closed content carries `hidden`, and the region here is never `hidden`, so the reference is always valid and a reader can jump to the region before opening it.
- **The region is `role='region'` with `aria-labelledby` back to the trigger**, so it is named by its own trigger text. This is the right call for a single disclosure; a page with many of them will accumulate landmarks, which is where **Accordion**'s engine — region optional — is the better fit.
- **Closed content is out of the tab order and the accessibility tree** through `visibility: hidden`, not clipping. A test asserts the content exists in the DOM while closed and that a field inside keeps its value across a toggle.
- **`@disabled` keeps the trigger focusable** with `aria-disabled='true'` and no native `disabled`, so a keyboard user still finds it and hears that it is disabled. The click is refused and the callback does not fire.
- **Enter and Space come from the native button**, so there is no key handling to get wrong, and nothing here manages focus — correct for the pattern.
- **The caret is `aria-hidden`.** The label span is the trigger's only accessible text; a `<:trigger>` block is announced as whatever you put in it, so put text in it.
- What is the caller's: the trigger has no heading semantics. If the disclosure is a section of a document, wrap it in the heading you mean.

## Theming

Consumed directly: `--foreground`, `--muted-foreground` (the caret), `--hover` (trigger hover fill), `--ring` (focus outline), `--radius-chip` (trigger corners), `--track-ui`, and the size scale `--pretui-size-xs` … `--pretui-size-xl` with `--text-ui-xs` … `--text-ui-xl` as the fallbacks.

The component's own knobs: `--pretui-collapsible-h` (minimum trigger height, 2.24em) and `--pretui-collapsible-px` (trigger inline padding, 0.5em — also the negative margin that keeps the label flush with the content edge).

Motion is the kit's: `--pretui-dur-morph` / `--pretui-ease-morph` for the fold, `--pretui-dur-snap` / `--pretui-ease-snap` for the caret. A season retunes every Collapsible's expand by retuning the morph pair; the reduced-motion branch removes both transitions and the trigger's press scale. The 600 trigger weight, the 0.45em caret and the 0.985 press scale are fixed.

## React ecosystem

| React | Pretui |
| --- | --- |
| `open` / `onOpenChange` / `defaultOpen` | the same names |
| `disabled` | `@disabled` (aria-disabled, stays focusable) |
| `isExpanded` / `onExpandedChange` (Aria) | `@open` / `@onOpenChange` |
| `<Collapsible.Trigger>` | `@label` or `<:trigger>` |
| `<Collapsible.Content>` | `<:default>` |
| `unmountOnExit` / `forceMount` | not offered; the region is always mounted |
| `data-state`, `data-disabled` | both present, both `'true'`/`'false'` strings |

**Accordion** is N of these behind boxel-ui's engine; **Disclosure** is the React Aria name for this component.
