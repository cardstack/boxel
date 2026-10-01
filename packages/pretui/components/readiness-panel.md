## What it is

A go/no-go panel: a list of gates, a verdict derived from them, and the action the verdict is about.

## The contract

```
@title (required) — what is being judged: "Deploy to production", "Publish listing"
@summary?    — optional sub-line under the verdict
@gates?      — the gates, in the order they should be read
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

## Prior art

The pre-flight and readiness checks in deployment and publishing UIs.

Where Pretui is better: the derivation order being explicit, and the applicable/empty distinction. Both are the things that make a readiness panel trustworthy — a panel that says "ready" because it had nothing to check is worse than no panel.

Where it is thinner: no per-gate remediation actions, no re-run, and no history of previous verdicts.

## Accessibility

- **The title is a real heading at `@headingLevel`**, so the panel is findable.
- **The verdict is a word**, carried by text rather than by the panel's colour.
- **Each gate carries its own state as text**, so a blocked gate is identifiable without scanning for a red mark.
- **Order matters and is preserved** — `@gates` is read in the order given, which is the order the reader should consider them.
- **`@applicable={{false}}` rendering nothing is an accessibility property too**: an empty panel announced as a region with a heading and no content is a dead end.
- **The action beside the verdict** means a keyboard user reaches the decision and the act of taking it in sequence, rather than tabbing past a gate list to find a footer.

## Theming

The verdict and gate states take the kit's semantic hues; the panel takes the shared surface and heading tokens.

Sharing the semantic scale is what lets a "blocked" gate here look like every other blocking state in the product, which matters for a panel whose entire job is to be believed.
