# Project

{{project.objective}}

# Current Issue

ID: {{issue.id}}
Summary: {{issue.summary}}

Description:
{{issue.description}}

{{#if knowledge}}

# Knowledge Articles

{{#each knowledge}}

## {{title}}

{{content}}

{{/each}}
{{/if}}

# Instructions — DESIGN FOUNDATION TURN

You are establishing the design language for this entire build, BEFORE
any card is designed in detail. Coherence first; detail later. Every
future design and build turn will treat your artifacts as binding.

Work strictly top-down:

## 1. Survey the catalog BEFORE you decide anything

You are about to write a guide that binds every later turn. Write it over
what exists, not over a blank page — a signature chosen in ignorance of the
catalog is the most expensive kind, because every card afterwards pays for it
by refusing components it could have reused.

- Sweep the catalog for the domain this build is in: what cards, fields,
  **components** and **commands** already serve it. `catalog-reuse` has the
  query shapes — follow it rather than inventing a query.
- This is **read-only reconnaissance**. You are not dispositioning anything
  and you write no reuse table; each card's own design turn does that. You
  are answering one question: *what rendering vocabulary already exists here?*
- `post_update` what you found — the component families worth designing
  toward, in a sentence or two.

## 2. Look & feel

Read the project Knowledge Articles above (port background / brief
context) and the issue backlog (`Issues/*.json` — the card family). Then
decide the overall visual direction, informed by §1:

- What should this app FEEL like? Name the mood in 3–5 guiding words
  (e.g. "quiet instrument", "editorial warmth", "utility bench").
- What are the reference points (products, print, materials)?
- What is the ONE visual signature this family owns (a rule, a texture,
  a typographic move — something recognizable across every card)?

Post your direction via `post_update` (kind: `decision`) before writing
any files.

## 3. Brand guide + Theme

Write these artifacts:

- **`Knowledge Articles/brand-guide.json`** — a KnowledgeArticle whose
  content carries: the guiding words (with one sentence each on what
  they permit and forbid), the palette (with usage roles, not just
  swatches), the typographic scale and families, spacing/radius/shadow
  rules, and 3–5 explicit dos/don'ts. This is prose a future agent reads
  to make decisions you didn't anticipate.

  **Constrain it to tokens and positive direction.** This guide is written
  before anyone knows what the cards need, and it binds every later turn.
  Say what the family *is* — its palette, type, spacing, signature. Do not
  ban a rendering pattern outright ("no icon treatments", "no pills, ever"):
  a later turn reads that as a rule and refuses a component or field that
  would otherwise have been reused, trading something real for a preference
  formed in ignorance of it. If a pattern genuinely conflicts with the
  direction, say what the family does instead and why — a "don't" that names
  no alternative is a defect in this artifact.

  **A positive signature excludes just as hard as a ban.** "Avatars are a
  solid accent disc with two initials" forecloses every avatar component in
  the catalog exactly as "no illustrated avatars" would. So your authority
  stops at the **token layer** — palette, type, spacing, radius, shadow,
  elevation, voice — which theming can apply to anything. Do **not** fix the
  *rendering form* of a concept a component could supply: avatar, link,
  status, badge, tag, rating, progress, thumbnail, empty state. Declare each
  of those **open**, in these words:

  ```
  avatar: open — settled at card design, subject to what the catalog supplies
  link treatment: open — settled at card design
  ```

  A card's design turn settles them with the catalog in view, and closes the
  style gap by theming what it adopts. Where you have a genuine preference,
  write it as a preference ("we lean quiet over decorative") rather than a
  specification — the difference is whether a later turn reads it as a rule
  it must refuse a component to obey.
- **The project `Theme`** — the platform has a first-class theme system and
  this build uses it rather than a private vocabulary of its own.
  - First look for an existing Theme worth adopting (the catalog and the
    target realm both) — `boxel search` for `Theme` instances. Prefer
    adopting or extending one over authoring a new one; a shared theme is
    what makes an adopted component look native here.
  - Otherwise author one: a `Theme` card instance in the target realm,
    carrying the palette, type, spacing, radius and shadow decisions above
    as its structured theme variables. Name it for the project.
  - Record the Theme's card id in the brand guide. Every card's build turn
    links it via `cardInfo.theme`, and every template reads its variables.
- **`design/tokens.css`** — a **mirror of the Theme**, generated from it, for
  mockups to link (`screenshot_html` renders plain HTML, which cannot read a
  card's theme). One `--*` variable per Theme variable, same names. It is a
  mockup-time convenience, **never the source of truth**: when a value needs
  to change, change the Theme and regenerate this file. A variable that
  exists here and not in the Theme is a defect — it produces a mockup no card
  can actually reproduce, and a vocabulary no external component can match.
  Comment each group with its guiding word.

## 4. Family coherence sheet

Write **`design/family-sheet.html`** — one page, linking `tokens.css`,
showing a SIMPLE version of EVERY card in the domain side-by-side (one
representative surface each — a tile or row per card type, with real
sample copy from the domain). This is NOT detailed design: no fitted
quanta, no per-format matrices. It answers one question: **do these
cards look like one family?**

Then `screenshot_html({ path })`, `Read` the PNG, and critique for
coherence — same visual weight? same voice? does the signature carry?
Name the defects, revise ONCE, re-screenshot. Post the round via
`post_update`.

## 5. Done

Detailed per-card design (fitted sub-formats, per-format content
matrices, mockup crit rounds) happens in each card's own design turn —
they will read your brand guide, Theme, and family sheet as binding
context. Do NOT do detailed design here.

Call `signal_done` when the brand guide, the Theme, tokens.css, and the
critiqued family sheet are all written.
