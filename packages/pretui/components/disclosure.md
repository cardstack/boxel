## What it is

**Collapsible** under the name React Aria uses. The export is the same class — `import { Disclosure } from './disclosure';` and `import { Collapsible }` from the same module resolve to one component — so the tile exists for the reader who arrives with the Aria vocabulary: a port of an Aria `Disclosure`, or an agent whose first guess is that word. The contract, the behaviour and the depth are on **Collapsible**; this page says what the Aria names map to. **Accordion** is several of these behind boxel-ui's engine; **Fold** is the agentic receipt shape.

## The contract

```
@open?           — controlled state (Aria isExpanded)
@defaultOpen?    — uncontrolled initial state (Aria defaultExpanded)
@onOpenChange?   — every toggle, with the next state (Aria onExpandedChange)
@label?          — trigger text; sugar for <:trigger>
@disabled?       — aria-disabled, still focusable (Aria isDisabled)
@size?           — the kit size scale (xs · s · m · l · xl)
@hideCaret?      — drop the rotating chevron
<:trigger as |open|>   — the DisclosureButton content
<:default>             — the DisclosurePanel
```

**The Aria spellings are not accepted.** `isExpanded`, `onExpandedChange` and `isDisabled` have to be renamed at the call site; the alias gives a port the component name, not the arg names.

## Prior art

**React Aria `Disclosure`** is a headless pair — `DisclosureButton` and `DisclosurePanel` — with `isExpanded` / `defaultExpanded` / `onExpandedChange` / `isDisabled`, `useDisclosure` for the ARIA wiring and no animation of its own; a consumer animates the panel or uses the `hidden="until-found"` mode for find-in-page. It also ships a `DisclosureGroup` (one open at a time), which here is **Accordion**'s job.

What this has that Aria's does not: the height animation, with content that stays mounted and is taken out of the tab order through `visibility` when closed; a built-in rotating caret; a `@label` shortcut so the common case is one line. What Aria's has that this does not: `hidden="until-found"` (closed content here is never `hidden`, so browser find never expands it), the `DisclosureGroup` wrapper, and the `isExpanded` spellings.

## Accessibility

Collapsible's, exactly, and it is the APG **Disclosure** pattern Aria's component is named after: a native `<button>` with `aria-expanded` and `aria-controls`, a `role='region'` panel labelled by its trigger, Enter and Space from the native button, closed content removed from the tab order, and `@disabled` as `aria-disabled` so the trigger stays discoverable. The trigger carries no heading semantics; wrap it in the heading you mean.

## Theming

Collapsible's tokens: `--foreground`, `--muted-foreground`, `--hover`, `--ring`, `--radius-chip`, the `--pretui-size-*` and `--text-ui-*` scales, the component's own `--pretui-collapsible-h` and `--pretui-collapsible-px`, and the kit motion pairs `--pretui-dur-morph` / `--pretui-ease-morph` (fold) and `--pretui-dur-snap` / `--pretui-ease-snap` (caret). Nothing is themed under a Disclosure name.

## React ecosystem

| React Aria | Pretui |
| --- | --- |
| `isExpanded` / `defaultExpanded` | `@open` / `@defaultOpen` |
| `onExpandedChange` | `@onOpenChange` |
| `isDisabled` | `@disabled` |
| `<DisclosureButton>` | `@label` or `<:trigger>` |
| `<DisclosurePanel>` | `<:default>` |
| `<DisclosureGroup>` | **Accordion** |
| `hidden="until-found"` | not offered |
