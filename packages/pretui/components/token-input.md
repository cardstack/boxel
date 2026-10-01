## What it is

A free-entry list of short values as removable chips — the array-of-values row.

The distinction that matters: **MultiSelect** needs a fixed vocabulary. This does not. Tags, keywords, email addresses, arbitrary labels — anything where the set is whatever the reader types.

## The contract

```
@value?, @defaultValue? — controlled / uncontrolled list
@label?         — accessible name for the entry field; required in practice
@placeholder?
@controlId?     — id for the entry field, so a PropertyRow label points at it
@describedBy?
@max?           — cap on the number of members; the field goes inert at the cap
@allowDuplicates? — default false
@disabled?
@mixed?         — multi-selection whose lists differ
@onChange?      — fires on every accepted add and every remove
```

**Duplicates are rejected by default, because every one of these lists is a set in disguise.** Tags, keywords, recipients — a repeated member is almost always a mistake, and the opt-in is there for the rare list that is genuinely a bag.

**The field goes inert at `@max`** rather than accepting and silently dropping.

**`@mixed` is for multi-selection editing** — several records selected, their lists differing — which is a state a naive component renders as either the first record's list or an empty one, both of which are lies.

## Prior art

**None.** figui3 has no equivalent, and MultiSelect solves a different problem: it needs the vocabulary in advance.

So the comparison is against what call sites do instead — a comma-separated text field, which pushes parsing, trimming, de-duplication and display onto every consumer, and gives the reader no way to remove one member without editing a string.

Where it is thinner: no suggestions while typing — that is **Autocomplete**'s territory and the two do not compose today — no paste-splitting on commas or newlines as a documented behaviour, no per-token validation, and no reordering.

## Accessibility

- **The entry field is named** through `@label` or a wrapper's `@controlId`. An unnamed chip entry is announced as a bare text box with no indication that it builds a list.
- **Each chip carries its own remove control with its own name**, so removing the third tag is a distinct, findable action rather than one of N identical buttons.
- **A rejected duplicate should be perceivable.** The field refuses silently today, which is the weakest point of the component: a reader who types an existing tag sees nothing happen.
- **Reaching `@max` makes the field inert**, which is announced through the disabled state rather than through a message.
- **`@mixed` needs saying in the UI**, not just in the data — a partial state that looks like a normal list will be committed as one.

## Theming

The chips are the kit's **Chip** treatment and the field is the kit's input, so a token row inherits both rather than defining a surface of its own.

That is what keeps a tag row looking like the chips used elsewhere in the product — a token input that invented its own chip is how two visually different "tags" end up on the same screen.
