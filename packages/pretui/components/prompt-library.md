## What it is

A searchable, filterable shelf of prompt templates, each with a use action and an optional copy.

## The contract

```
@prompts (required) — the shelf
@title?       — heading. Default 'Prompt library'
@query?, @onQueryChange? — controlled search text
@category?, @defaultCategory?, @onCategoryChange? — the filter; 'all' shows everything
@onUse?       — fires when a prompt is chosen — the primary action
@useLabel?    — default 'Use'
@onCopy?      — fires when a prompt's text is copied; OMIT to hide the copy action
```

**Omitting `@onCopy` hides the copy action.** The kit's recurring rule: an affordance that does nothing is worse than none.

**Use and copy are different intentions.** Use puts the prompt into a composer; copy puts it on the clipboard for somewhere else entirely, and a library that only offered one would be wrong for half its readers.

**Search and category are both controllable**, so a host can persist them or drive them from elsewhere.

## Prior art

The prompt-library surfaces in agent products.

Where Pretui is better: not substantially — this is a shelf, and the value is in it being one component with a consistent contract rather than a bespoke grid. The copy gate is the one decision worth keeping.

Where it is thinner: no template variables or fill-in-the-blank interaction, no favourites or recency, no authoring — the shelf is read-only — and no per-prompt preview beyond what the card shows.

## Accessibility

- **The shelf is a named region** and search is a real labelled field, so filtering is reachable without a pointer.
- **Category filtering is a real control group**, not a row of styled divs.
- **Each prompt's use and copy controls carry the prompt's name**, so a shelf of twenty does not present forty buttons called "Use" and "Copy".
- **The filtered count should be perceivable.** Search that silently changes what is on screen leaves a screen-reader user unaware that anything happened.
- **Copy success needs announcing by the host** — this component reports the event and does not own the confirmation.

## Theming

The shelf uses the kit's card, input and control tokens throughout.

A prompt library is a browsing surface, and it should look like every other browsing surface in the product — which is why nothing here is separately themeable.

The styles sit in `@layer PretComposite`, above Input's `PretComponent` layer, so what this component sets on Input wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
