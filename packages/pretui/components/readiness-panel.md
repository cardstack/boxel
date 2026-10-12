## What it is

A go/no-go panel: a list of gates, a verdict derived from them, and the action the verdict is about.

## The contract

```
@title (required) — what is being judged: "Deploy to production", "Publish listing";
               in the list variant, the list's accessible name
@variant?    — 'panel' (default) or 'list': the gate rows alone
@summary?    — optional sub-line under the verdict
@gates?      — the gates, in the order they should be read; each is
               { id?, name, state, caption?, value?, href? }
@verdict?    — state it outright; omit and it is DERIVED: any fail or blocked gate
               → blocked; else any running or pending → pending; else any unknown
               → unknown; else, with at least one gate, ready
@applicable? — render nothing at all when the panel does not apply
@headingLevel? — heading level for the title within the host page

<:actions> the action the verdict is about — beside the verdict, not in a footer
<:empty>   replaces the built-in empty state
<:default> anything that belongs under the gate list
```

**`@title` is required because the source's hardcoded domain title is the single thing that made it unreusable.** That is stated in the type, and it is the clearest example in the kit of a required arg existing because of a specific past failure.

**The verdict is derived unless stated**, with a precedence that is written down rather than implied: blocked beats pending beats unknown beats ready, and no gates at all is not "ready".

**`@applicable={{false}}` renders nothing at all.** An empty shell reads as "no problems", which is not what "not applicable" means — a distinction the source got right and worth keeping.

**The actions sit beside the verdict**, not in a detached footer, because "Deploy" belongs next to "Ready".

**A gate's `href` links its name, and only its name.** The glyph, caption, value and state chip stay outside the anchor, so the link reads as "Lint" and the state is announced from the chip beside it, not folded into the link text.

**`@variant='list'` is the gate rows alone**, for a check list nested under another record, such as the failing CI checks under a pull request. There is no Panel surface, heading, verdict, reasons, actions or live region. The root is the `<ul>` itself and `...attributes` land on it. `@title` stays required and names the list (`@gatesLabel` overrides it), so a list is never unnamed. `@loading`, the empty state and `@applicable` behave as in the panel; `@verdict`, `@reasons`, `@summary`, `@announce`, `<:actions>` and `<:default>` are ignored. A caller who needs a verdict uses the panel. Both variants render the same row markup, so a gate looks the same in either.

## Prior art

The pre-flight and readiness checks in deployment and publishing UIs.

Where Pretui is better: the derivation order being explicit, and the applicable/empty distinction. Both are the things that make a readiness panel trustworthy — a panel that says "ready" because it had nothing to check is worse than no panel.

Where it is thinner: no per-gate actions beyond a link to the source (`href`), no re-run, and no history of previous verdicts.

## Accessibility

- **The title is a real heading at `@headingLevel`**, so the panel is findable.
- **The verdict is a word**, carried by text rather than by the panel's colour.
- **Each gate carries its own state as text**, so a blocked gate is identifiable without scanning for a red mark.
- **A linked gate's link text is its name.** The state stays outside the anchor, and the link has a visible focus ring.
- **The list variant is a named list**: a `<ul role='list'>` labelled by `@title` or `@gatesLabel`, with no heading and no live region, so a page of nested check lists adds no landmarks and no announcements.
- **Order matters and is preserved** — `@gates` is read in the order given, which is the order the reader should consider them.
- **`@applicable={{false}}` rendering nothing is an accessibility property too**: an empty panel announced as a region with a heading and no content is a dead end.
- **The action beside the verdict** means a keyboard user reaches the decision and the act of taking it in sequence, rather than tabbing past a gate list to find a footer.

## Theming

The verdict and gate states take the kit's semantic hues; the panel takes the shared surface and heading tokens.

Sharing the semantic scale is what lets a "blocked" gate here look like every other blocking state in the product, which matters for a panel whose entire job is to be believed.

A linked gate name keeps the name's colour and weight, underlines on hover, and takes a `--ring` focus outline. The list variant is its own size container, so the narrow-row wrap at 26rem holds without the panel around it.

The styles sit in `@layer PretComposite`, above Panel's `PretComponent` layer, so what this component sets on Panel wins by layer order. A caller's unlayered CSS overrides both without a more specific selector.
