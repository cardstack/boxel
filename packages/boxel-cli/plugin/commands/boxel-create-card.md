---
name: boxel-create-card
description: Create a new CardDef, FieldDef, or small card family with all required formats.
boxel:
  kind: skill
---

# /boxel-create-card

## Use When

- The user wants a new CardDef, FieldDef, or small card family.
- They describe a domain ("a recipe card", "a project tracker", "a quote document") without yet having code.

## Inputs

- Realm URL or local realm path.
- The card concept (one sentence is fine).
- Whether sample JSON instances are needed.

## Read (REQUIRED, in order)

1. `skills/boxel/references/design-playbook.md` — THE process: stage 0 planning (mandatory for card families) + mockup → extract → tokenize → derive. Read in full first.
2. `skills/boxel-ui-guidelines/references/delegated-render-control.md` — REQUIRED if this card embeds other cards via `<@fields.X @format='...' />`.
3. `skills/boxel-patterns/patterns/app-card-home-with-search/README.md` — REQUIRED for card families (2+ related CardDefs).
4. `skills/boxel-patterns/patterns/cardinfo-override-title/README.md` — the `cardTitle` override.
5. `skills/boxel/SKILL.md` (cardinal rules; focus `references/core-concept.md`).
6. `skills/boxel/references/base-field-catalog.md` — reach past `StringField` when the value has a known shape.
7. `skills/boxel/references/icons.md` — CDN verification is the only proof an icon exists.
8. `skills/boxel/references/lint-workflow.md` — the lint gate, and what lint does NOT catch.
9. `skills/boxel-environment/references/indexing-operations.md` — post-push verification gates.
10. `skills/source-code-editing/SKILL.md`.
11. Check `skills/boxel-patterns/SKILL.md` for a ready pattern matching the outcome.

## Procedure

1. Inspect the realm for existing conventions. Decide CardDef vs FieldDef and `contains` vs `linksTo`.
2. **Card family?** Produce the Stage 0 artifacts from `design-playbook.md` (Goal · Brief · DataModelPlan with thunk marks · Sample Data · ASCII Layouts · MicroMockups with content matrices) BEFORE any production schema.
3. **Run design-playbook stages 1-4** (the verbatim art-director brief lives there). Mandatory for any user-facing card; skip only for utility cards. Push after each stage.
4. Implement every `fitted` template per `boxel/references/container-query-fitted-layout.md`; walk all 16 sizes per `boxel/references/fitted-formats.md`.
5. If any format embeds children, apply `delegated-render-control.md` before writing the parent's CSS.
6. Per CardDef: override `cardTitle` (and `cardDescription` when computable); decide `static prefersWideFormat` now (`boxel/references/prefers-wide-format.md`); assign a `static icon` only after a CDN probe returns 200.
7. For families, build the Home card per `app-card-home-with-search`.
8. Sample instances when requested: follow `/boxel-create-instance`. Content in the design's editorial voice — never Lorem ipsum.
9. Lint gate per `lint-workflow.md`: `npx boxel file lint` before push, `npx boxel lint` after.
10. **Verification gates per `indexing-operations.md` — lint is NOT the gate.** Per CardDef: module-load probe (`get-card-type-schema` → `status: ready`) AND typed-search count matches intended instance count.
11. Render smoke test per CardDef in the live app before claiming done.

## Done Criteria (self-verify)

- [ ] Playbook stages ran in order; stage-1 self-critique passed; fitted features the card's media and renders cleanly at all 16 sizes (`fitted-formats.md`).
- [ ] Chrome contract honored — no format's outermost element decorates itself (per-format table, `design-playbook.md` stage 4).
- [ ] Every embed site passes the `delegated-render-control.md` checkpoints (format choice, plural-field selectors, atom chrome, divider strategy).
- [ ] `cardTitle` overridden, `prefersWideFormat` decided, icons CDN-verified, queries follow `query-systems.md`, templates pass the cardinal rules.
- [ ] Instances pass the `/boxel-create-instance` done criteria; a Theme card exists and is linked from every non-Theme sample instance.
- [ ] Home card exists if this build introduced 2+ related CardDefs.
- [ ] Lint clean before and after push, both `indexing-operations.md` gates pass, and a render smoke test ran.

## Failure Recovery

- SEARCH/REPLACE didn't match: read the file again, include a unique nearby marker, retry with a smaller window.
- Card renders as "Untitled <Class>" → add the `cardTitle` override per `cardinfo-override-title`.
- Card looks unstyled → missing `cardInfo.theme` link OR the Theme card has empty `cssVariables`.
- `cardOrThunk was undefined` → bad import or unresolved cycle; see the error table in `indexing-operations.md`.
- "instanceof check fails after import" → constructor passed unboxed through `{{...}}`; box it (pattern `organize-resource-class-data-loader`).
