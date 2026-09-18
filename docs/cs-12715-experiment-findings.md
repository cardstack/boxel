# CS-12715 — experiment findings

Running the plan's verification protocol against the branch. Steps 1–6 below
are complete; steps 7–8 (live agent turns) follow.

Stack: the warm dev stack already running from the `cs-12715-spike` worktree
(realm-server 4201, host 4200). It only serves realms — the code under test is
the factory and parse gate run from `cs-12715-reuse`.

Active profile confirmed `@user:localhost` before any run. Not staging.

---

## Step 0 — corpus

The plan expects `Author` at **rank 1** for the `specType: card` + `matches:
"author"` query. Actual:

| rank | name     | module                                         |
| ---- | -------- | ---------------------------------------------- |
| 1    | BlogPost | `@cardstack/catalog/7af9aa-blog-app/blog-post` |
| 2    | Author   | `@cardstack/catalog/7af9aa-blog-app/author`    |

Two hits, `Author` second. Not a blocker — the reuse contract requires every
hit be dispositioned, so rank only affects which one the agent reads first —
but the plan's "expect: Author at rank 1" is not what this corpus returns.

The field modules the spike used are **not** under the blog-app directory:
`author.gts` imports them as `../fields/…`, so they serve from
`@cardstack/catalog/fields/contact-link/contact-link` and
`@cardstack/catalog/fields/featured-image/featured-image`, both `export
default`.

## Step 3 — source, not transpiled

Confirmed against the live realm, exactly the plan's numbers:

| request                               | bytes  | form                                             |
| ------------------------------------- | ------ | ------------------------------------------------ |
| plain `GET …/author.gts`              | 66,915 | transpiled — 18 `dt7948` lowered-decorator sites |
| `Accept: application/vnd.card+source` | 27,570 | the file on disk                                 |

## Steps 1–2 — the four shapes, against the live catalog

Driven through the real `runGlintCheck` with a real fetch (not the stub used
in the unit tests).

| shape                                             | result   |
| ------------------------------------------------- | -------- |
| A — extends catalog card, no template             | PASS     |
| B — extends catalog card, overriding `isolated`   | **FAIL** |
| C — base `CardDef` + catalog field, with template | PASS     |
| D — base `CardDef` + catalog field, no template   | PASS     |

B's error is **not** a resolution failure. It is:

```
Class static side 'typeof ContributorB' incorrectly extends
base class static side 'typeof Author'.
```

Getting a precise structural error rather than "cannot find module" is itself
the evidence that the resolver worked: the real `Author` type resolved.

### What actually blocks shape B

Varying one thing at a time:

| variant                                                            | result   |
| ------------------------------------------------------------------ | -------- |
| override `isolated` on catalog `Author`                            | FAIL     |
| override `fitted` only                                             | PASS     |
| add a field, override `isolated`                                   | FAIL     |
| add a field, no template                                           | PASS     |
| **local** parent, override `isolated`                              | PASS     |
| **local** parent whose `isolated` has an extra member, override it | **FAIL** |
| override `isolated` redeclaring the parent's extra member          | FAIL     |

`Author.isolated` declares `get themeStyle()` alongside its template. A
subclass overriding that static with a plain `Component<typeof this>` is not
assignable to it, and redeclaring the member does not help — `typeof this`
binds to a different class on each side.

**This is pre-existing and has nothing to do with catalog reuse.** The last
row reproduces it entirely inside one local file, with no catalog, no realm
prefix and no fetch. So:

- The plan's Step 2 table ("B: shim fail → real types pass") holds only for a
  parent whose template statics carry no extra members. For a parent like
  `Author` it does not, and no parse-gate change can make it.
- It is the same mechanism the spike named when it called `Author`
  `REUSE-BLOCKED` — "welded to `blog-defaults`' `themeStyleFor`". The spike's
  verdict was right; what is wrong is the expectation that fixing the parse
  gate would unblock this shape.
- Card-level adoption remains available: adopt and override `fitted`, or adopt
  and add fields without overriding the parent's decorated template. What is
  blocked is overriding a template the parent decorated.

The unit tests in `parse-realm-imports.test.ts` assert the shim/real-types
distinction against a stub parent with plain statics, which is the honest
version of the claim — it isolates what the resolver controls.

## Steps 4–6

- Interpolator: the plan's five cases pass, including the nested if-else case
  that previously rendered `AT{{#if y}}YB`.
- Delivery: `catalogSkills()` shows the real `catalog-reuse` description
  rather than `>-`; the resolver names it for implementation _and_ design
  issues; every named skill resolves; the system prompt renders the reuse
  block through both real backends, and fails when the flag is unwired.
- Suite: `pnpm test:node` 662 pass, 1 failure — the `port-allocator`
  dual-stack test, which fails while a dev stack holds ports. Baseline.

---

## Steps 7–8 — the live run

Brief: the spike's own `Wiki/field-notes` — a magazine publication described in
contributor vocabulary, never using the word "author", with an editorial
calendar as the card that has no catalog equivalent. Same brief and same
corpus as the spike, so the outcomes are comparable.

Run: `--to-phase implementation`, default flags (catalog reuse on), stopped
after the **Contributor** card. Contributor is the card the catalog can
actually answer; the remaining three would re-measure the same mechanism at
four times the token cost.

Note on phases: `--to-phase design` does **not** run the per-card design
turns. It runs bootstrap and design-foundation and leaves the implementation
issues on the board. The design turn is the first half of an implementation
issue, so the reuse step only runs under `--to-phase implementation`.

### Criterion 1 — the gate accepts a catalog-importing card

`run_parse` inside the run, on the shipped card:

```
run_parse: {"status":"passed","filesChecked":4,"filesWithErrors":0,
            "errorCount":0,"parseableFiles":["contributor.gts", …]}
```

`contributor.gts` carries `import FeaturedImageField from
'@cardstack/catalog/fields/featured-image/featured-image'` and
`import ContactLinkField from '@cardstack/catalog/fields/contact-link/contact-link'`.
`run_lint`, `run_evaluate` and `run_instantiate` also passed, and nothing in
the log resolves a catalog specifier to an error. This is the end-to-end
proof, through the real pipeline rather than a test harness: on `main` this
parse fails on the imports alone.

### Criterion 2 — a reference traceable to a decision row

Two, both traceable to `REFERENCE` rows in `design/contributor-NOTES.md`:

| shipped import                           | notes row                           |
| ---------------------------------------- | ----------------------------------- |
| `…/fields/featured-image/featured-image` | portrait — image + caption + credit |
| `…/fields/contact-link/contact-link`     | webLinks — label + url pairs        |

### Criterion 3 — the four rules

`REFERENCE 2 · REUSE-BLOCKED 1 · GAP 0`, and one hand-written definition in
the shipped card (`Contributor`).

1. **Need #1 is the card.** Row 1 is "Contributor (the card itself)",
   dispositioned against catalog `Author`. This is the card-level row four
   spike rounds never produced.
2. **Every hit dispositioned.** Three catalog hits, three reasoned rows.
3. **Base-realm imports not counted.** The agent labelled `MarkdownField`,
   `TextAreaField`, `EmailField` and `StringField` "(base — not a reuse
   decision)" in its own words. Mechanical check: 0 base-realm rows marked
   `REFERENCE`.
4. **Blocked adoption surfaced with a mechanism**, not silently downgraded:
   _"every format template is welded to the blog-app's `.blog-scope` theme
   world — `themeStyleFor(this)` runtime CSS block, `var(--blog-color-_)`"\*.

That refusal names, independently, the same weld isolated by hand in Steps
1–2 above. The agent reached it from reading the module; the variant table
reached it from the type error.

The substantive win is what is **absent**: no hand-written credited-image or
link-list FieldDef. The notes say so explicitly — _"No `CreditedImageField` is
authored in this pass. The catalog's `FeaturedImageField` IS the
credited-image field for Field Notes."_

### Deviation from the contract, and one scoring correction

- **`GAP` is 0 where the contract expects 1.** The hand-built Contributor card
  is dispositioned as `REUSE-BLOCKED` (against `Author`, reason given, ending
  "Build new") rather than as a separate `GAP` row. Substantively every
  hand-built definition is accounted for with a reason, but the label is not
  the one the prompt specifies, and a scorer keyed on `GAP` would read this
  as an unrecorded hand-build. The spike split this into two rows
  (card = `GAP`, `Author` = `REUSE-BLOCKED`). The prompt should say which it
  wants when the reason a thing is built new _is_ a blocked adoption.
- The scoring script's "hand-written definitions" count is not trustworthy as
  written — it counted 77 by sweeping `run-log.gts`, `run-telemetry.gts` and
  `.boxel-history/`. The real count for the shipped card is 1.

### Not tested

The **editorial-calendar control** — the card with no catalog equivalent,
which would show whether the contract can be gamed into reporting reuse where
none exists. Its issue was still on the board when the run was stopped.

---

## Control run — is the unstyled card a regression?

The Contributor card renders unstyled: white ground, default sans, none of the
brand guide's warm paper, serif display, left rule or terracotta accent. The
question is whether this branch caused it.

**It did not.** Control: a worktree at `3280ec8943` — the exact commit this
branch starts from — with the same brief, the same corpus, a fresh realm
(`fieldnotes-control`), and the same host dist and CLI build so the agent's
tooling is identical. `packages/host` is untouched by this branch (`git diff
--name-only 3280ec8943 HEAD -- packages/host` is empty), so reusing its build
compares like with like.

|                                            | this branch | control (unmodified) |
| ------------------------------------------ | ----------- | -------------------- |
| `var(--…)` references                      | 113         | 132                  |
| …carrying a fallback                       | 0           | 0                    |
| token definitions in the card              | 7           | 0                    |
| defines `--color-paper` / `--font-display` | no          | no                   |
| catalog imports                            | 2           | 0                    |

Both renders are unstyled, confirmed two independent ways: statically, by the
token accounting above, and visually, from the render gate's own PNGs. The
control is marginally worse on both counts — it references more undefined
tokens, defines none at all, and its labels collide with their values
(`EMAILamara@fieldnotes.press`) for want of spacing tokens.

### The actual cause

`design/tokens.css` holds every palette and type value. A mockup is an HTML
page and `<link>`s it, which is why the accepted mockup looks right. A card is
a `.gts` with `<style scoped>` blocks and has no way to load a workspace CSS
file, so at render time every `var(--color-paper)` resolves to nothing and the
browser falls back to its defaults. No gate catches it: parse, lint, evaluate
and instantiate all pass on CSS that references undefined variables.

The brand guide states the false assumption outright — _"Canonical tokens live
in `design/tokens.css`. Every mockup links that file; every `.gts` template
references those `var(--_)` names."\* True of mockups, false of cards.

Worth noting: catalog `Author` solves exactly this by injecting a runtime
`<style>` block scoped to `.blog-scope` via `themeStyleFor(this)` — and that
weld is the reason the agent marked `Author` `REUSE-BLOCKED`. The pattern
rejected as unreusable is the pattern that makes a card render standalone.

Out of scope for this ticket; it reproduces on `main` and needs its own.

### Incidental

The control produced **zero** catalog imports against the same brief and corpus
where this branch produced two. That is criterion 2 moving in the intended
direction, but with one run per arm it is consistent-with, not evidence of, an
effect.
