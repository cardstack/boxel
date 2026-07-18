# Project

{{project.objective}}

{{#if project.successCriteria}}
Success criteria:
{{#each project.successCriteria}}
- {{.}}
{{/each}}
{{/if}}

# Knowledge

{{#each knowledge}}

## {{title}}

{{content}}
{{/each}}

# Current Issue

ID: {{issue.id}}
Summary: {{issue.summary}}
Status: {{issue.status}}
Priority: {{issue.priority}}

Description:
{{issue.description}}

{{#if issue.checklist}}
Checklist:
{{#each issue.checklist}}
- [ ] {{.}}
{{/each}}
{{/if}}

{{#if toolResults}}

# Tool Results

You previously invoked the following tools. Use these results to inform your implementation.

{{#each toolResults}}

## {{tool}} (exit code: {{exitCode}})

```{{outputFormat}}
{{output}}
```

{{/each}}
{{/if}}

# Instructions — DESIGN TURN

This is the **design half** of a phase-split issue. Your ONLY deliverables
are accepted HTML mockups and design notes — a separate build turn (running
on a cheaper budget, forked from this session) will translate them into
card code. Do NOT write any `.gts`, `.json` instance, or Spec in this turn.

**Live-blog as you go.** Call `post_update` at every meaningful moment —
design kickoff, what each critique round found (name the defects), the
decision that resolved it. First person, 1–3 sentences.

## 1. Ground yourself

- **Scope check FIRST**: read `Knowledge Articles/build-plan.json` and
  your issue's "In scope (this pass)" list. Mock ONLY the in-scope
  surfaces at the in-scope sizes — if this pass says "fitted tile only,"
  do not design the wide strip or expanded card (a pass-2 issue owns
  those). Depth over breadth: make the small scope excellent.
- **BINDING design language — read it FIRST when it exists:**
  `Knowledge Articles/brand-guide.json` (guiding words, palette, rules),
  `design/tokens.css` (the CSS variables — your mockup MUST link this
  file and use its `--*` variables, never invent new colors/type), and
  `design/family-sheet.html` (what the family looks like — your card
  must read as a sibling of those, not a new style). Deviating from the
  brand guide is a defect; if the guide genuinely can't express this
  card, post the tension via `post_update` and extend the tokens rather
  than fork them.
- `Read` / `Glob` the workspace; `Bash` + `boxel search --realm <target-realm-url>` for cards already in the target realm.
- Call `list_skills`, then `read_skill` the skills this issue touches.
  Read precedent: if a similar card exists in the workspace, read its `.gts`.

## 2. DESIGN — mock, screenshot, critique, revise

- Write `design/<card-slug>.html`: **ONE page** — plain HTML+CSS mockup with
  **hard-coded, realistic sample copy** (never lorem ipsum). Every surface on
  that one page, labeled: isolated (mobile; wide variant if the card prefers
  wide), fitted tiles (badge / strip / card), an embedded row.
- `screenshot_html({ path })`, `Read` the PNG, and **critique it**: name
  concrete defects (hierarchy, wrapping, spacing, color, copy) against the
  design language. Revise and re-screenshot. At least one full
  crit-and-revise pass; stop when you would show it to a designer.

## 3. Hand off

- Write `design/<card-slug>-NOTES.md`: the accepted design's intent in
  build-ready terms — schema fields implied by the mockup (names + types +
  which are FieldDefs), the CQ breakpoints used, theme-token mapping for
  every hard-coded color/size in the mockup, and any traps the builder must
  not miss. This file is the build turn's contract; write it like a spec.
- `post_update` a `decision` summarizing the accepted design.
- Call `signal_done`. Do NOT set issue status; do NOT write card code.
