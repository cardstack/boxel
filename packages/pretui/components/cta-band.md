## What it is

The closing call-to-action band: an eyebrow, a headline, a lead and the controls that end a page.

## The contract

```
@eyebrow?  — small line above the headline
@headline (required) — names the band
@lead?     — one paragraph under the headline
@tone?     — semantic hue. Default 'primary'
@appearance? — visual weight. Default 'accent'
@align?    — 'center' (default) for a closing band, 'start' when it sits inside
             a column of left-aligned prose
@headingLevel? — heading level in the host page

<:default> — the call-to-action controls
```

**`@headline` is required because it names the band**, and a call to action with no statement is a row of buttons.

**`@align` has two right answers for two placements.** Centred is correct for a full-width closing band; start-aligned is correct when the band sits in a column of prose, where centring would break the reading column.

**`@headingLevel` exists because a block does not know its page** — the same rule **StepsWithMedia** and **HeroSplit** follow.

**The actions are a block**, not data. This is the one place in the marketing set where the caller genuinely needs arbitrary controls.

## Prior art

The closing CTA section on every marketing page.

Where Pretui is better: the heading level as an argument, and tone and appearance resolving through the kit's recipe system so the band matches the season rather than being a hand-picked colour block.

Where it is thinner: no background media, no split arrangement, and no dismissal — this is a section, not a banner.

## Accessibility

- **The headline is a real heading at `@headingLevel`**, so the band participates in the document outline.
- **`@eyebrow` is context, not a heading**, and does not compete in the outline.
- **The band's tone is a token pair**, so the ink on it comes from the same recipe — which is what stops a strongly-coloured CTA from failing contrast when a season changes its primary.
- **`@align='center'` centres the text**, which is harder to read at length — keep the lead short, and use `start` inside prose.
- **The actions are whatever the caller puts there**, and their names are the caller's responsibility.

## Theming

`@tone` and `@appearance` resolve through the kit's shared recipe system; alignment and heading level are structural.

Because the band is a recipe rather than a colour, a season that expresses `accent` through a border rather than a fill gets a bordered CTA automatically — which is the behaviour a hardcoded background would prevent.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
