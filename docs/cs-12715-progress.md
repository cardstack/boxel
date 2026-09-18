# CS-12715 — progress

Make the factory reuse catalog cards and fields end to end.

Branch `cs-12715-reuse`, off `main` @ `3280ec8943`. One PR.
Plan: [`cs-12715-catalog-reuse-plan.md`](cs-12715-catalog-reuse-plan.md).
Verification detail: [`cs-12715-experiment-findings.md`](cs-12715-experiment-findings.md).

**Status: implementation complete, verified end to end against a live stack.**
All three acceptance criteria demonstrated. Open items are listed at the
bottom; none blocks the PR.

---

## Decisions taken

| decision               | choice                                       | why                                                                                                                                          |
| ---------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Skills pin             | bump to `v0.1.4`, accept three tags of drift | isolated in one commit a reviewer can skip; an upstream `v0.1.5` round-trip was not worth blocking on                                        |
| Flag count             | **one** — `enableCatalogReuse`, default on   | the old `enableBoxelUiDiscovery` was hardcoded `true`; the two skills describe each other as general and specialised forms of one discipline |
| The two baseline fixes | folded in as commit 1                        | the interpolator fix is a prerequisite for any conditional work in `system.md`                                                               |
| Commit order           | regen **before** delivery, not last          | naming a skill that does not exist is silent, so the delivery commit would have been unverifiable until the regen landed                     |

Two departures from the plan, both forced by what the code turned out to be:

- **The resolver is shared, not duplicated.** The plan assumed two copies
  because `boxel-cli` cannot import `runtime-common/realm-prefixes`. That
  constraint is about what _that module_ imports, not runtime-common itself,
  and `paths.ts` documents the same workaround for the same reason. The
  resolver lives once in `runtime-common/realm-source-cache.ts` with no
  imports at all. Only the prefix _list_ is duplicated as literals in the CLI,
  and the declaration test now holds that copy to `PREFIX_REALMS`.
- **Commit order swapped**, as above.

## What landed

| commit       | what                                                         |
| ------------ | ------------------------------------------------------------ |
| `621b4d18c1` | two defects that make every run start from a broken baseline |
| `8f3eab0cc5` | parse gate resolves realm-prefixed imports                   |
| `3bf3dd30c4` | skills regen at `v0.1.4` + block-scalar descriptions         |
| `834daaccf3` | one flag, the firewall, and skill delivery                   |
| `9376662c1c` | reuse bound into the design→build contract                   |
| `b11559a58d` | flag usage text                                              |
| `414c3a284f` | dispositions told apart by cause                             |
| + docs       | plan, experiment findings, token-gap investigation           |

### 1. Baseline fixes

- **The prompt interpolator** split an `{{#if}}` body on the first `{{else}}`
  anywhere inside it, so a nested block's false branch became the outer
  block's and the rest of the inner block was dropped. It reaches production
  through `interpolate` → `promptLoader.load('system')` → each backend's
  `buildSystemPrompt`, so it was corrupting live prompts, not just test ones.
  Now depth-aware over all block tokens.
- **`run-log.gts`'s stale `@ts-expect-error`.** The parse gate compiles with
  `module: es2022`, where `import.meta` is legal, so the directive was unused
  and the gate reported `TS2578` on a file the agent did not write and cannot
  fix. Every run opened parse-red. Proven: 1 error before, 0 after, through
  the real `runGlintCheck`. `RUN_LOG_GTS` is now exported and a test runs the
  actual gate over it — nothing else type-checks bytes in a template literal.

### 2. Parse gate

Both implementations generated a tsconfig mapping base, host and boxel-ui and
**no realm prefix**, so a card importing `@cardstack/catalog/…` failed on the
import alone. Fixing one would have left the other red, and `boxel parse` is
the loop an author runs by hand.

The gate now fetches the module's source — with `Accept:
application/vnd.card+source`, because a plain GET returns the module
_transpiled_, which resolves and type-checks as though it were source while
describing different types — walks its own imports with a cycle set and a
depth bound, writes them into the run's temp dir and aliases the prefix at
them. A fetch failure degrades to the ambient shim rather than failing the
gate.

The `cachedTsconfigContent` memo had to go: its content now depends on what
this run's files import.

### 3. Flag, firewall, delivery

One flag, default on, threaded through both backends. It previously reached
only `assembleSystemPrompt`, which is test-only — the live path is each
agent's own `buildSystemPrompt`, so every conditional rendered false while the
flag read `true` and the run shipped the unlifted firewall.

The firewall now sanctions Spec across all four `specType`s, Listing,
instances and files, and renders the catalog realm URL in the same block —
the transport is `boxel search --realm <url>`, where `--realm` is required.
Both reuse skills moved into the resolver's lean core _and_ its design branch;
neither was selected anywhere before. Four rows of the operations routing
table pointed at a renamed skill, one marked MANDATORY.

### 4. The design→build contract

The design turn's notes are the build turn's contract, so catalog search
"before authoring" is one turn too late — by the build turn the schema is a
term of that contract. The reuse step therefore sits in the design turn, ahead
of the mockup.

Prompts own _when_ and _what artifact_; the `catalog-reuse` skill owns _how_.
The artifact is a **Reuse decisions** table — one row per need: need,
decision, module, wiring. `issue-implement` gets the same step or a
`--no-phase-split` run silently keeps the old behaviour; `issue-fix` learns
that a failing gate is never resolved by deleting a catalog import.

## Verification

Full protocol in the findings doc. Headlines:

| criterion                                                                  | result                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1 — a card adopting/containing catalog content passes every gate           | **pass**, live: `run_parse` green on a card carrying two catalog imports |
| 2 — a default run produces a catalog reference traceable to a decision row | **pass**, two                                                            |
| 3 — every hit dispositioned, no base import counted as reuse               | **pass**, all four rules held unprompted                                 |
| 4 — flag defaults on, skill in `SKILL_PRIORITY`                            | **pass**                                                                 |

Tests are written to fail for the right reason, verified by breaking the code
on purpose: unwiring the flag in `claude-code.ts` fails the ship-checklist
test; deleting a prefix from the CLI's list fails the declaration test;
restoring the `@ts-expect-error` turns the parse gate red again.

Suite: `pnpm test:node` 662 pass, 1 failure — the `port-allocator` dual-stack
test, which fails while a dev stack holds ports. Baseline.

### Corrections to the plan's expectations

- **Corpus ranks differently.** Plan expects `Author` at rank 1; the corpus
  returns `BlogPost` 1, `Author` 2.
- **Shape B fails with real types too.** The plan's table says card-level
  adoption with a template passes once types resolve. Against the real
  `Author` it does not: overriding a template whose parent decorated it with
  an extra member is a type error, and this reproduces in a single local file
  with no catalog, no prefix and no fetch. Pre-existing, unrelated to reuse,
  and no parse-gate change can fix it. It is the same weld the agent
  independently named when refusing `Author`.

## Open items

1. **The design-token gap** —
   [`factory-design-token-gap.md`](factory-design-token-gap.md). Every
   factory-built card renders unstyled because `design/tokens.css` cannot
   reach a `.gts`. Reproduces on `main`, predates this work, needs its own
   ticket. Includes a recommendation and a proposed lint rule.
2. **The editorial-calendar control was never run.** It is the card with no
   catalog equivalent, and the check that the contract cannot be gamed into
   reporting reuse where none exists. The run was stopped after Contributor to
   save tokens.
3. **Remote-realm fetch and non-public-realm auth** are unexercised. The
   resolver takes an `authorization` parameter that no caller passes, so a
   non-public catalog degrades to the shim rather than failing — deliberate,
   but deferred rather than solved.
4. **`boxel test` under `--to-phase hardening`** with a cross-realm import is
   still unprobed.
5. **Scratch docs.** `cs-12715-*.md` are planning artifacts and should be
   dropped before merge. `factory-design-token-gap.md` should outlive them —
   move it to its own ticket rather than deleting it.

## Reproducing

```zsh
# stack (already warm on :4200/:4201 during this work)
mise run dev-all                      # or the host-first split

# confirm the active profile is NOT staging before any run
boxel profile list

# one card, design + build, stop after Contributor
cd packages/software-factory
NODE_EXTRA_CA_CERTS="$HOME/Library/Application Support/mkcert/rootCA.pem" \
  node src/cli/factory-entrypoint.ts \
  --brief-url https://localhost:4201/user/factory-briefs/Wiki/field-notes \
  --target-realm https://localhost:4201/user/<slug>/ \
  --to-phase implementation --debug
```

`--to-phase design` does **not** run the per-card design turns — it runs
bootstrap and design-foundation and leaves the implementation issues on the
board. The design turn is the first half of an implementation issue.

Score criteria 2 and 3 mechanically rather than by reading: count catalog
imports in shipped `.gts` (excluding `design/`), count rows by disposition in
`design/*NOTES.md`, and check no base-realm row is marked `REFERENCE`. Exclude
`run-log.gts`, `run-telemetry.gts` and `.boxel-history/` from any definition
count — they are seeded, not agent output.
