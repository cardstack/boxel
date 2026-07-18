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

## 1. Look & feel

Read the project Knowledge Articles above (port background / brief
context) and the issue backlog (`Issues/*.json` — the card family). Then
decide the overall visual direction:

- What should this app FEEL like? Name the mood in 3–5 guiding words
  (e.g. "quiet instrument", "editorial warmth", "utility bench").
- What are the reference points (products, print, materials)?
- What is the ONE visual signature this family owns (a rule, a texture,
  a typographic move — something recognizable across every card)?

Post your direction via `post_update` (kind: `decision`) before writing
any files.

## 2. Brand guide + tokens

Write TWO artifacts:

- **`Knowledge Articles/brand-guide.json`** — a KnowledgeArticle whose
  content carries: the guiding words (with one sentence each on what
  they permit and forbid), the palette (with usage roles, not just
  swatches), the typographic scale and families, spacing/radius/shadow
  rules, and 3–5 explicit dos/don'ts. This is prose a future agent reads
  to make decisions you didn't anticipate.
- **`design/tokens.css`** — the same decisions as CSS custom properties:
  `--*` variables for every color role, type size/weight/family,
  spacing step, radius, and shadow. Every future mockup links this file;
  every future `.gts` template mirrors these variables. Comment each
  group with its guiding word.

## 3. Family coherence sheet

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

## 4. Done

Detailed per-card design (fitted sub-formats, per-format content
matrices, mockup crit rounds) happens in each card's own design turn —
they will read your brand guide, tokens, and family sheet as binding
context. Do NOT do detailed design here.

Call `signal_done` when the brand guide, tokens.css, and the critiqued
family sheet are all written.
