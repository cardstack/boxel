---
name: catalog-reuse
description: >-
  MANDATORY before writing any `.gts`. Boxel ships a curated catalog; search it before you author. Classify what you need, then apply the matching reuse operation: a **Listing** when the whole card or app may already exist (install or remix it), a **Spec** when you need building blocks (a CardDef to link, a FieldDef to contain, a component or command to import), an **instance** when you need content that already exists (point a relationship at it). Build new only for confirmed gaps. For UI primitives inside a `.gts` template, use boxel-ui-component-discovery instead.
boxel:
  kind: skill
  tools:
    - codeRef:
        module: '@cardstack/boxel-host/tools/search-entries'
        name: default
      requiresApproval: false
---

# Catalog Reuse

Boxel ships a **curated catalog**: whole apps and cards packaged for
installation, the definitions they are built from, components, commands, themes,
and assets — real, tested parts other people finished and shipped.

**First classify what kind of thing you need. Then apply the reuse operation for
that kind.** Everything below is that one idea, made operational.

## Non-negotiable rules

1. **Never author before searching.** By the time you write the first line of
   any `.gts`, a catalog query must already have returned.
2. **Never treat a Spec as the reusable object.** A Spec is an index entry. You
   reuse what its `ref` names, or an instance from its `linkedExamples` — never
   the Spec itself.
3. **Never conclude a gap after one failed query.** Broaden once (step 5) before
   declaring anything missing.
4. **Never pass over a suitable result without recording why.** Every hit is
   adopted, or refused in writing naming what mismatched.
5. **Never hand-copy a Listing's files.** Reuse it whole through `install` or
   `remix`.
6. **Prove it at the end.** For everything you authored from scratch, be able to
   name the reuse option above it and why it was unusable. "I didn't look" means
   it needs replacing.

Reading design or pattern references is not a substitute for searching: they
tell you how to build well, not whether to build at all.

## Required workflow

1. **Enumerate** every card, field, component, command, app, theme, and asset
   the brief implies, in plain language.
2. **Search Listings** for the deliverable as a whole.
3. **If no Listing answers the brief**, search Specs for each enumerated need.
   Skip this when an accepted Listing already covers the brief.
4. **Search instances** when a need is content-shaped — a particular author,
   theme, config, image, or a sample to start from.
5. **Evaluate** each hit against the need; broaden once before calling anything
   a gap.
6. **Build only confirmed gaps**, and record them.
7. **Self-audit** before finishing.

Step 3 is mandatory only when step 2 does not produce an acceptable whole
solution — if you install a Listing that answers the brief, the part-level
searches are moot.

## Reuse strategy: classify, then operate

Every search here is a search over card instances — `Spec` and `Listing` are
ordinary card types, and so is `Author`. What differs is what a hit **denotes**.

| You need | Anchor on | A hit denotes | Operation |
|---|---|---|---|
| the whole thing | `Listing` | an installable bundle | `install` as-is · `remix` when you will modify the copy |
| parts to build with | `Spec` | a module export, named by `ref` | link · contain · extend · import |
| content that exists | the card type itself | the instance | point a `linksTo` / `linksToMany` at it · or copy and edit |

Nothing exports a Listing, so no CodeRef names one: **a Spec query can never
return a Listing, and a Listing query can never return a bare definition.**
Different anchors, because they describe different kinds of thing.

### Parts: what each `specType` entitles you to

Take the target from the hit's `ref` (module + name) and wire **that**.

| `specType` | The export is | How you wire it |
|---|---|---|
| `card` | a **CardDef** | `linksTo` / `linksToMany` as a field · `extends` to specialize · `adoptsFrom` in an instance |
| `field` | a **FieldDef** | `contains` / `containsMany` · `extends` to specialize |
| `component` | a Glimmer component | import into your template's markup |
| `command` | a Command | import and invoke, or run through your session's command mechanism |
| `app` | an AppCard family | ships as a **Listing** in practice → use the Listing anchor |
| `file` | an asset | an **instance** → use the instance anchor |

**A CardDef is *linked*; a FieldDef is *contained*.** `@field author =
linksTo(Author)` is how you reuse a card definition; a FieldDef is contained,
never linked.

`specType` crosses these rows — four values name module exports, `app` is in
practice a Listing, `file` is an instance. It is advisory and sometimes absent,
so constrain it explicitly rather than assuming every Spec carries one.

**You may import catalog modules directly.** `@cardstack/catalog/` is a
registered import prefix, so a catalog module imports straight into your `.gts`
across realms — you do not have to copy the file in.

Within parts, prefer more whole over less: a card over a field, a field over
hand-rolled markup. This is not a queue — a need that *is* a field starts at the
field. What it forbids is hand-building a part when a bigger unit contains it.

### Content: two different instance searches

- **Catalog instances — this is reuse.** Anchor on the card type and search the
  catalog. A hit is something to point a relationship at, or to copy and edit.
- **Your own realm — this is a self-check.** Same tool, your realm. It answers
  "have I already built this?", not "has the catalog?", and does **not** satisfy
  step 2 or 3.

`linkedExamples` on a Spec hit is the direct route from a definition to the
instances the catalog ships for it. Check it before authoring instances by hand.

**Declaring a relationship and filling it are different steps.** You declare
`@field author = linksTo(Author)` from a Spec hit's `ref` (parts); you fill it by
pointing `relationships.author` at an existing `…/Author/jane.json` you found by
searching instances (content). Same keyword, different step.

## Search mechanics

**Transport.** Use whichever search you actually have — the queries below are
identical either way.

- **The `search-entries` tool**, which this skill makes available wherever tools
  are. It spans every realm you can read, catalog included, so you need no realm
  URL and should not go looking for one.
- **`npx boxel search --realm <realm-url> --query '<filter-json>' --json`**,
  where you have a shell instead. Here `--realm` is required and repeatable, so
  the catalog realm has to be passed explicitly; your environment guidance names
  its URL.

Card-search tools are a different thing again: they fetch live instances to
attach, open, or patch.

**Filter shape.** Card-rooted: an `on` type anchor plus `every` / `eq` /
`matches`, bare field names. Never hand-write `item.`-prefixed paths.

```json
{
  "filter": {
    "on": { "module": "@cardstack/base/spec", "name": "Spec" },
    "every": [{ "eq": { "specType": "field" } }, { "matches": "address" }]
  },
  "sort": [{ "by": "_matchRelevance", "direction": "desc" }]
}
```

`specType` is advisory and sometimes absent, so the broadened retry drops it —
this is the form to reach for when the constrained query returns nothing:

```json
{
  "filter": {
    "on": { "module": "@cardstack/base/spec", "name": "Spec" },
    "matches": "address OR postal OR location"
  }
}
```

For Listings the anchor is
`{ "module": "@cardstack/catalog/catalog-app/listing/listing", "name": "Listing" }`;
for content, the card type itself.

**`scope`** is `'cards' | 'files' | 'all'` and selects card-instance rows vs file
rows. It is orthogonal to which type you anchor on — Specs, Listings and Authors
are all card instances. Use `'files'` for assets.

**Two query rules that decide outcomes:**

- **`matches` ANDs its words.** `"person author"` means *person AND author*.
  One concept per query; spell alternatives as `"person OR author"`. Keep an
  `OR` set to terms of comparable specificity — one generic word swamps it
  (`"game OR card OR gambling"` against a catalog of cards returns everything).
  An empty result from a multi-word `matches` is a malformed query, not a gap.
- **`_matchRelevance`** scores 0–1, best first, and is appended for you when the
  filter carries a positive `matches`. Read the scores, do not just take rank 1:
  a flat spread of low scores means the query was too broad. The sort is only
  valid alongside `matches` — requesting it on a `type`-only filter is rejected.

Deeper query semantics: `boxel/references/query-systems.md`,
`boxel/references/spec-usage.md`.

## Evaluating hits

Read each hit's `specType`, `cardTitle`, `cardDescription`, and `readMe`. A text
match is a candidate, not a decision. The `readMe` is the source of truth — it
carries the API contract, and `search-entries` returns it in full on the hit, so
judging needs no follow-up read. `cardDescription` is often empty, so `readMe`
and `ref` are usually what settle it. Judging on the title alone is how a Spec
that answered the need gets discarded.

**If a need returns nothing, broaden once** before concluding a gap: re-query
with two or three alternates joined by `OR`, and drop the `specType` constraint.
Each result carries a `total`, showing how much of the match set the page did not
show. The catalog is a corpus of app-specific parts, not a standard library, so
"nothing fits" is often correct — but it is a verdict you record, never one you
take silently.

**Then disposition every hit**: adopted, or refused naming what actually
mismatched — the fields it lacks, the design rule it breaks. A hit that is
neither is the failure this skill exists to prevent.

**Reading a hit is not adopting it.** Opening a found card to understand its
shape and then authoring your own is a refusal, not a reuse — record it as one,
naming why the hit itself could not be linked, installed, or copied.

## Edge cases

- **Whole apps** ship as Listings, not app Specs, so a Spec sweep for `app` may
  return empty. Use the Listing anchor.
- **Themes** are instances — link one through `cardInfo.theme`, or copy and edit
  when it must diverge.
- **Files, images, fonts, icons** are instances too — search with
  `scope: 'files'` and `linksTo` what you find.
- **Installing beats copying.** Copying re-types code that already exists, costs
  a large multiple of an install, and drifts from the original. Visual or naming
  differences are not a reason to skip reuse: install and restyle, or remix if
  the schema must change. `catalog-listing` has the mechanics.
- **Reuse *from a user realm* does mean copying.** User realms have no import
  prefix and literal realm URLs are lint-banned. This restricts user realms, not
  the catalog — catalog modules import directly.
- **Base-realm imports are the baseline, not the target.** Importing from the
  base realm and `@cardstack/boxel-ui` is what every card already does. This
  skill is about what you add on top.

## Self-audit before finishing

Re-read what you built. For everything you authored from scratch:

- Which reuse operation did I answer it with — Listing, part, or instance?
- Was there really no Listing? If I installed one, did I stop there?
- If I authored instance JSON, did I check whether the catalog already ships one?
- Does every refusal name its mismatch, and is every real gap recorded?

If the honest answer to any of these is "I didn't look", that thing needs
replacing with its catalog equivalent. Only then is it done.

## Related

- `boxel-ui-component-discovery` — the specialized front-end for UI primitives;
  use it whenever the task is writing template UI. This skill is the general form.
- `catalog-listing` — install / remix / update mechanics for Listings.
- `boxel-file-structure` — the `linksTo`-vs-`contains` rule, module paths, and
  where definitions and instances live on disk.
- `boxel` — CardDef / FieldDef authoring, query syntax.
