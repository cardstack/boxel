# Design Playbook — Mockup → Extract → Tokenize → Derive

> This playbook replaces the "build a fitted layout from a recipe" approach. It puts the design FIRST and the system SECOND — the inverse of theme-first. Use it for any CardDef whose visual identity matters. Skip for utility cards.

## Why this exists

The cards that look best in this workspace share one thing: **they were designed by an agent that hadn't been told what design rules to follow.** Direct hex colors. Named fonts. Specific pixel sizes. Real editorial decisions.

Modern Sonnet/Opus models have strong intrinsic visual taste from training on Pentagram-quality work. When unconstrained, they reach for those decisions. When the skill tree prescribes tokens, ratios, layout patterns, the ceiling drops to "fine." This playbook restores the agent's intrinsic taste at stage 1 — and only THEN extracts a system from what taste produced.

**Trust your intrinsic design taste. This playbook is a process, not a CSS rulebook.** If a `#hex` color is right for this card, use it. If Inter is the right font, name it. If your layout doesn't need container queries, don't reach for them. The cards that look best in this realm were built by NOT following a rulebook.

---

## Planning before code — Stage 0 (mandatory for card families)

The kits that come out looking pedestrian skipped this stage. They jumped straight to `static isolated`, found their schema thin, and the fitted view ended up as "name + one number." Don't do that.

For any card family with **2+ related CardDefs**, produce these planning artifacts as a writeup BEFORE any real `.gts` schema is written. The source workspace for this pattern is `app.boxel.ai/.../actual-duck-82` (data-model-plan.gts, architecture-plan.gts, micro-mockups.gts) — each one is a CardDef whose `static isolated` IS the plan document, optionally pushed to the realm so the user can review.

| Stage 0 step      | Deliverable                                                                                                                                                                                                  | Format                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0a. Goal          | One paragraph: what the family does, who it serves, the single deliverable.                                                                                                                                  | Prose in a plan card OR `.md`                                                                                                                |
| 0b. Brief         | What makes this UNIQUE and IMPORTANT for users. Why a person would adopt this over their current spreadsheet/Notion/Airtable. The one-line value prop + the three concrete user moments.                     | Prose in the same card                                                                                                                       |
| 0c. Data model    | CardDef list + FieldDef list + relationships, as an ASCII data-flow diagram. Show which fields are sensitive vs shared. Show which fields have computed values.                                              | ASCII diagram, fenced. See "ASCII data-model template" below.                                                                                |
| 0d. Sample data   | 3-5 instances of each CardDef, written as plain-prose dossiers. The names, the numbers, the dates, the photo captions. Real-feeling content, not lorem ipsum.                                                | Markdown bullets or a `Sample Data` card.                                                                                                    |
| 0e. ASCII layout  | A box layout for the `isolated` template of each CardDef. What's at the top-of-the-fold, what's eyebrow vs headline vs meta, where the image goes, what the divider strategy is.                             | ASCII art with labels. See "ASCII layout template" below.                                                                                    |
| 0f. Micro mockups | Sketch each format (isolated, embedded, fitted, edit) at desktop AND mobile. Hi-fi mockups — exact placement, real fonts named, the divider strategy decided, what gets cut when the card shrinks to fitted. | A `MicroMockups` CardDef whose `static isolated` IS the mockup board. See `app.boxel.ai/.../actual-duck-82/micro-mockups.gts` for the shape. |

These stage-0 artifacts can ship in the realm as actual cards (the `actual-duck-82` approach — `ArchitecturePlan`, `DataModelPlan`, `MicroMockups` are all CardDefs whose isolated view IS the plan document). That lets the user review and revise the plan visually in the same app where the eventual cards will live. Push them to the realm BEFORE writing the production CardDefs.

### ASCII data-model template

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       <kit name> · DATA FLOW                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   User does X:                                                           │
│      "Akane finished assessment 3, scored 18/20"                         │
│                          │                                               │
│                          ▼                                               │
│                ┌─────────────────┐                                       │
│                │  AI INTERPRETS  │                                       │
│                └────────┬────────┘                                       │
│                         │                                                │
│         ┌───────────────┼───────────────┐                                │
│         ▼               ▼               ▼                                │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐                             │
│   │ EntryA   │   │ EntryB   │   │ EntryC   │   ← structured CardDefs     │
│   └──────────┘   └──────────┘   └──────────┘                             │
│         │                                                                │
│         ▼                                                                │
│   ┌──────────────────┐                                                   │
│   │ Queries + Reports│                                                   │
│   └──────────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────────┘

Multi-realm security:
  Sensitive realm: FullProfile, ParentInfo, CustodyNotes
  Operational realm: PublicStub, PublicSummary
  Shared realm: ActivityFeed, LessonPlans
```

### ASCII layout template

```
┌─ ISOLATED ─────────────────────────────────────────────────────────────┐
│  EYEBROW · CATEGORY · STATUS                                            │
│                                                                         │
│  ┌─────────────────────────────────┐  HEADLINE                          │
│  │                                 │  (large serif, 1 line)             │
│  │     HERO IMAGE (16:9)            │                                   │
│  │                                 │  subtitle / kicker                  │
│  └─────────────────────────────────┘                                   │
│                                                                         │
│  ┌─── meta row ───┐                                                     │
│  │ AUTHOR · DATE · READ TIME · PRICE · RATING                           │
│  └────────────────┘                                                     │
│                                                                         │
│  ─── hairline ────────────────────────────────────────────────────────  │
│                                                                         │
│  BODY: 2-column flowing markdown                                        │
│         linksToMany side rail                                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─ FITTED (tall, 100×200) ──┐   ┌─ FITTED (wide, 300×100) ─────────────┐
│  HERO                      │   │                       HEADLINE        │
│  IMAGE                     │   │  HERO IMAGE           subtitle        │
│                            │   │  (square)             ── meta dot     │
│                            │   │                       category        │
│ ──────                     │   └───────────────────────────────────────┘
│ HEADLINE (truncated)       │
│ meta · meta                │   ┌─ EMBEDDED (variable) ────────────────┐
│ price/key fact             │   │ HERO   HEADLINE                       │
│                            │   │  IMG   subtitle                       │
└────────────────────────────┘   │        meta · meta · meta             │
                                  └───────────────────────────────────────┘
```

### Why stage 0 fixes the pedestrian-fitted problem

Without stage 0, the agent reaches for `name`, `description`, `date` as fields — three thin strings, and the fitted view becomes "title in big type, description truncated, date as muted small text." That's pedestrian because **the data isn't rich enough to compose with**.

Stage 0 forces the agent to:

- Identify the one or two SIGNATURE fields that make this card visually distinctive (a hero image, a price, a rating, a status pill, a brand mark).
- Decide BEFORE writing schema what the fitted view's job is — show the price? show the photo? show the badge?
- Write sample data with real names, real prices, real photographs (URLs into the realm or attached). Lorem ipsum produces lorem-ipsum-looking cards.

Then stage 1's mockup has substance to arrange.

### Stage 0c — cycle discipline (thunk-by-default)

While drafting the Data Model Plan, mark every `linksTo` / `linksToMany` whose target is **another CardDef in the same kit**. Every one of those — on BOTH sides of the cycle — uses the `() => Class` thunk form:

```ts
// Both sides of every kit-internal cycle
@field style = linksTo(() => Style);
@field designer = linksTo(() => Designer);
@field referenceProjects = linksToMany(() => Project);
```

Bare `linksTo(X)` works ONLY when X is fully evaluated by the time the field decorator runs. Inside a kit with back-edges (Project ↔ Style, Project ↔ Designer, Project ↔ Material, etc.), the timing is unreliable and `cardOrThunk was undefined` fires at runtime with lint and TypeScript both clean. Defensive thunk-by-default for every linksTo in a kit is the spelling of the operator, not an opt-in.

Add a "thunk" column to the field table in your DataModelPlan card; every row that links to another kit card gets a ●.

### Stage 0f IS a stage-1 deliverable

The Micro Mockups card (stage 0f) is not "make a hi-fi rendering of each format." It's "apply the Pentagram-art-director / internal-taste-maker brief to EACH CardDef in the family, in advance, so production has a drama target to copy." Without this framing, mockups land as competent editorial layout with no signature gesture, and the production agent copies what it sees — pedestrian.

For each CardDef, before laying anything out, answer in source comments above its mockup section:

```
// AUDACIOUS MOVE: what makes this card unmistakable? (one sentence)
// PENTAGRAM WOULD: what would a great art director ALWAYS do here? (one sentence)
// TASTE MAKER REFUSES: what safe move did you decide NOT to make? (one sentence)
```

Then layout.

### Stage 0f — content matrix per format (MANDATORY)

Every CardDef in the mockup MUST have an explicit per-format content inventory. Not "fitted goes in a CQ grid" — that's layout. The inventory is content: what fields appear, what wording register, what's omitted at each size.

```
## <CardName> · content matrix

isolated:      full document — every field, formal register
               hero: <field>
               ribbon: <fields>
               body: <fields>
               footer: <fields>

embedded:      identification + 2-3 status fields
               hero: <field>
               meta: <field>, <field>
               wording: <register note>

fitted/large:  hero 60% + caption 40%
               fields: <name>, <category>, <year>
               hidden: <list>

fitted/medium: caption compresses
               fields: <name>, <category>
               hidden: <list>

fitted/small:  name + status only
               fields: <name>, <dot>

atom:          single line, abbreviated wording
               fields: <name>, <dot>
               wording: $61.3k not $61,320

edit:          sectioned form
               section "Identity": <fields>
               section "<...>": <fields>
               special editors: <fields>
               read-only (computed): <fields>
```

Same data renders differently across formats. A Quote isolated says:

> Estimate № 0247 · The Hawthorne Bungalow · prepared for the Hawthorne Family of Portland, Oregon · 14 line items totaling $61,320 · valid 60 days

A Quote fitted says:

> Q0247 · Hawthorne · $61.3k · pending

A Quote atom says:

> Q0247 · $61.3k

The production agent copies these specs. Without them, fitted/embedded/atom land as "show the number and date" — data-empty cards that look styled but inform nothing. (See NBJ Quote fitted, which shipped with no customer name, no project name, no amount until corrected.)

---

## The four stages (after planning)

| Stage       | Goal                                     | Deliverable                                                                                                   | Variables? |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| 1. Mockup   | Make it look right at full size          | `static isolated` template, hardcoded everything                                                              | NO         |
| 2. Extract  | Capture the design DNA                   | A Theme card whose `cssVariables` ARE the mockup's palette                                                    | —          |
| 3. Tokenize | Make it editable through the theme       | Rewrite isolated to consume `var(--*)` references                                                             | YES (now)  |
| 4. Derive   | Take the identity to constrained formats | `fitted` + `embedded` + (optional) `atom`, all consuming the theme. **Fitted MUST feature the card's media.** | YES        |

Push to the realm after each stage so you can compare visually.

---

## Stage 1 — Mockup pass (the design challenge)

**Use this verbatim framing for the design itself:**

> Do a design exploration and generate only the above-the-fold view in isolated, framed as such. Write sample content for this use case and fit the elements in there as a design challenge executed by a brand-focused art director of Pentagram, judged by the preeminent taste maker in that field. (Specify who in your thinking, not your final summary.)

Hold the taste-maker in your head as you work. Bierut, Sagmeister, Paula Scher, Khoi Vinh, Massimo Vignelli, Mark Boulton — whoever fits the brief. The internal critic raises the bar; do NOT name them in your code or commit messages.

### Brand-guided imagery during mockup (not as a late asset fill)

Generated images belong in the mockup pass, not after. The Brand Guide, card copy, template composition, and Stage 0 sample data are the prompt for the image model — feed all of them in so the photo matches the surrounding type, palette, and voice. Late-stage "find a stock photo that fits" produces hero images that fight the design.

Concrete pattern:

```
brand DNA (palette, voice, reference vocabulary)
+ this CardDef's role (Project / Style / Material)
+ this instance's data (Beaumont Kitchen, 1924 Craftsman, white oak, Inset Shaker)
+ the composition slot (4:3 hero, lower-left scrim, no people, raking morning light)
→ image-gen prompt
```

For NBJ specifically, prompts for kitchen heroes included palette tokens (paper-tone background, oak browns, no high contrast), composition constraint (lower-third negative space for headline overlay), and visual reference (Made Thought monograph aesthetic). Generic prompts ("Inset Shaker kitchen") produced generic photos.

**What "designed" looks like in stage 1 — non-negotiables:**

- **Schema rich enough to compose with.** A card with 3-4 thin fields will look thin no matter the layout. If the design needs `cuisine`, `subtitle`, `rating`, `reviews`, `author`, `keyIngredient`, `difficulty`, `calories`, `description`, `imageUrl` — add them. Don't be precious about schema size.
- **Real, evocative sample content.** Write in the voice of the publication you're emulating (Bon Appétit, The New York Times, Apartamento, Pitchfork). The instance JSON is part of the design.
- **Hardcoded values everywhere.** `#fdfbf7`, `'Lyon Display', 'Garamond Premier Pro', serif`, `2.125rem`, `letter-spacing: 0.22em`. Real choices, no `var(--*)`, no theme tokens, no calc against tokens.
- **Typography pairing.** Two families with clear roles. Serif body + sans micro-labels is one option. Mono numerals + serif body is another. Two-sans-weights is a third. Pick deliberately.
- **Weight rhythm.** Large at LIGHT weight (300-400). Tiny at BOLD weight (700-800). Avoid uniform 500-600 weights — that's UI, not editorial.
- **ONE accent color in ≤2 places.** Pick a single accent that carries meaning (a brand color, a category tag, an action). Use it twice at most. Everything else neutral.
- **Letter-spacing on micro-labels.** `0.05em` to `0.22em` on uppercase eyebrows. Untracked uppercase reads cheap.
- **Editorial micro-objects.** Eyebrow + rules. Author avatar with initial. Star rating with fill states. Drop cap. Fold cue. Stats slab framed by `border-top` / `border-bottom` rather than enclosed in a box. Pick 2-3 of these moves; don't apply all of them.
- **Media is featured.** If the card has imagery (hero, cover, headshot), it appears at scale. Don't hide it in a corner.

**Self-critique before declaring done.** Imagine your taste-maker looking at the rendered card:

1. Does the typography pair on purpose, or default to one sans?
2. Is there weight rhythm, or are all weights between 500-600?
3. Do the micro-labels have letter-spacing?
4. Is there ONE accent, or are 3-5 theme tokens used as accents?
5. Is the schema rich enough that there's something to compose with?
6. Is the sample content evocative, or "Lorem ipsum / Untitled Project"?
7. Does the hero media (if any) get real real estate?
8. Are there 2-3 editorial micro-objects, or is it a flat grid of pills?
9. Would this fit in a magazine spread? In a Linear blog post? In an Apple keynote slide?
10. If you removed the data, would the visual identity survive?

If any answer is "no", iterate before stage 2.

**Push the mockup to the realm so it can be reviewed visually.** Theme card linkage is optional at this stage; if the host needs a theme card to render, link a placeholder.

---

## Stage 2 — Extract the theme

Scan your stage-1 CSS and pull every distinct decision into a named token. The Theme card you write here IS the design DNA — not a generic shadcn palette, not a guess at good defaults, the actual values that made the mockup work.

**Token roles to surface (use the names that make sense for THIS card):**

- **Color** — `--ink` (primary text), `--ink-soft` (secondary text), `--paper` (background), `--card` (raised surface), `--rule` (border/divider), `--accent` (the one accent), `--accent-soft` (accent at lower alpha if you used one). Skip `--secondary`, `--muted-foreground`, etc. if your design doesn't use them.
- **Typography** — `--font-display`, `--font-body`, `--font-mono` (only if used). Capture the exact font stacks. Add Google Fonts URLs to `cssImports`.
- **Scale / rhythm** — `--space-1` through `--space-5` if you used a deliberate spacing scale. Skip if the spacings were ad-hoc.
- **Radius / shadow** — name them only if you used them more than once.

**Don't add tokens the mockup didn't earn.** A shadcn-style palette of 20 tokens is wrong if your mockup used 6. The theme should fit the design, not the other way around.

**Theme card JSON shape:**

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "cardInfo": {
        "name": "<Theme Name>",
        "summary": "<one-line>",
        "notes": null,
        "cardThumbnailURL": null
      },
      "cssImports": ["https://fonts.googleapis.com/css2?family=..."],
      "cssVariables": ":root {\n  --ink: #0f172a;\n  ...\n}\n\n.dark {\n  --ink: #f1f5f9;\n  ...\n}"
    },
    "meta": {
      "adoptsFrom": {
        "module": "https://cardstack.com/base/card-api",
        "name": "Theme"
      }
    }
  }
}
```

Push the theme card.

---

## Stage 3 — Tokenize the mockup

Replace every hardcoded value in the isolated template with `var(--*)` references to your new theme. The card should be **pixel-identical** to stage 1.

- Every `#hex` → `var(--ink)` / `var(--paper)` / etc.
- Every `font-family: 'Lyon Display', ...` → `var(--font-display)`
- Every `letter-spacing: 0.22em` you used twice → consider `var(--eyebrow-tracking)`; if used once, leave inline
- Every `box-shadow: 0 18px 40px ...` you used twice → `var(--shadow-lift)`; if used once, leave inline

**Rule of two:** if a value appears once, leave it inline. If it appears twice or more, tokenize it. Don't manufacture tokens for single uses.

Link `cardInfo.theme` on the instance to your new Theme card. Push the updated `.gts` and the instance JSON.

Verify visually that stage 3 matches stage 1. If anything shifted, your theme extraction missed something.

---

## Stage 4 — Derive fitted + embedded

Now you have the design language (in the theme) and the flagship layout (in isolated). Derive the constrained formats from the visual identity.

**Critical — every format leaves outer chrome to the host.** Read `boxel-ui-guidelines/references/delegated-render-control.md` ("The flip side — what the CHILD card MUST NOT do"). The host wraps every format with a CardContainer that provides `border-radius`, `background`, `border`/`box-shadow`, `overflow: hidden`. The child format must NOT decorate its outermost element with these — the parent and host own the box; the child owns what's inside it.

This rule is what lets a parent (like the Row & Rail Programme showcase) embed your card and override the chrome to match its design language. If your `isolated` adds `border-radius: 8px` to its outer `<article>`, it fights every parent that tries to override.

Per format, outer-element rules:

| Format     | OK on outermost                                            | NOT OK                                                                                                                               |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `isolated` | `color`, `font-family`, inner padding, inner grid/flex     | `border-radius`, `border`, `box-shadow`, opaque `background`, `overflow`                                                             |
| `embedded` | same                                                       | same — plus no `width/height/max-width`                                                                                              |
| `fitted`   | `color`, `font-family`, inner padding, inner grid template | `border-radius`, `border`, `box-shadow`, `background`, `width/height/min/max-height`, `overflow`, `container-type`, `container-name` |
| `atom`     | inline content only                                        | `padding`, `border`, `border-radius`, `background`, any `display:` other than default                                                |
| `edit`     | form field spacing, internal layout                        | same as embedded                                                                                                                     |

**If the brand demands a specific outer treatment** (sharp corners, custom border), put it on the **Theme card** (`--radius`, `--background`, `--border`). The wrapper's `--themed` cascade picks it up. Every linked card gets it for free — without format CSS contention.

**Fitted — the one rule that's actually a rule: FEATURE THE MEDIA.**

If the card has a hero image, illustration, brand mark, or generated graphic, the fitted view leads with it. The thumbnail-sidebar / magazine-spread / stacked-with-hero patterns all qualify — what disqualifies is hiding the media under metadata. Container queries are FINE if you need them to switch layout modes (e.g., featured-image vs. text-only at different widths), but you can also just write three sub-templates by hand — whichever is clearer for THIS card.

Layout latitude in fitted:

- Keep the typography pairing from isolated (same `var(--font-*)` references)
- Keep the accent discipline (one color, ≤2 places)
- Keep one editorial micro-object if it scales (eyebrow with tracking does; drop cap doesn't)
- Drop the schema-rich content; show only the 3-4 fields that survive at 200×200

**Before declaring fitted done, walk all 16 named sizes.** The host previews fitted at 16 specific size boxes (3 badges + 5 strips + 5 tiles + 3 cards). A fitted layout that nails one size and breaks at another isn't done. The full table — Small/Medium/Large Badge, Single/Double/Triple/Double-Wide/Triple-Wide Strip, Small/Regular/CardsGrid/Tall/Large Tile, Compact/Full/Expanded Card — and the per-cell verification checklist live in [`fitted-formats.md`](fitted-formats.md). Use the live app's format preview to walk them visually; `npx boxel check` is not a substitute.

**Embedded — compressed isolated.**

Same fonts, same accents, ~half the content. Usually one hero image at a square crop, headline at the embedded-size in the same family, one line of supporting copy, one meta line. The "embedded card chip" look — but with the identity intact.

**Atom — optional.**

A single line, maybe with a chip. Use atom format when the card appears inline in prose ("attending [Event]"). Don't author atom unless your card is genuinely referenced inline. When you do, keep the atom content as raw inline text + maybe one icon — pad and frame via the parent's chip span using `@displayContainer={{false}}` (see delegated-render-control.md).

**Edit** — usually leave to host default unless your design truly demands a custom form layout.

Push each format.

---

## What NOT to do

- ❌ Use the container-query fitted guide as visual ideation. Design the fitted composition from the stage-1 mockup first; then implement every `fitted` template with the mandatory CQ mechanics in `container-query-fitted-layout.md`.
- ❌ Use `var(--*)` tokens before stage 2. The theme doesn't exist yet at stage 1.
- ❌ Add tokens the mockup didn't earn. Theme size should match design complexity.
- ❌ Introduce new design moves in stage 4 that aren't in the theme. Fitted is derived, not re-imagined.
- ❌ Hide the hero media in fitted. Media is the anchor.
- ❌ Use stock photos at fitted sizes — use a focused crop of the hero, or a brand-mark fallback. Stock thumbnails read as Lorem ipsum.
- ❌ Apply ALL the editorial micro-objects in one card. Pick 2-3 that serve the brief.
- ❌ Let the schema thinness force the design thinness. Add fields if the design demands them.
- ❌ Name the taste-maker in your commit messages, code comments, or final summary. Internal critic only.

---

## When to skip the playbook

- Utility cards (lookup tables, internal config)
- Field types not meant to be rendered on their own (compound fields wrapped by a parent)
- Cards whose primary surface is the edit form, not the read view

For everything else — anything a user will SEE — run the playbook.

---

## Sources to study

Reference points exist for each stage — open one and read it in full before starting the playbook on a new card.

- A standalone, non-Boxel design exercise (direct hex, Inter named, deliberate sizes — built without any skill-tree visual rules) is the cleanest reference for stage-1 freedom.
- A `<FittedCard>`-based slot-fill card family is the canonical reference for what design cohesion across a suite looks like.
- A per-card container-query implementation with editorial typography is the cleanest reference for stage-1 voice + stage-4 derivation.

Ask the user for a specific URL when you need to study one of these directly — paths vary per workspace.
