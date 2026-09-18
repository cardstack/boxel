# CS-12715 — Make the factory reuse catalog cards/fields end to end

Implementation plan. Branch off `main` @ `3280ec8943`.

One PR, matching the ticket's own framing: _"One vertical slice, three parts
that must all land."_ The parts are not independently valuable — the gate
without the contract changes nothing, the contract without the gate re-measures
the same null, and the firewall without either is inert. Acceptance criterion 2
is only demonstrable end to end, so no subset can be verified against it.

Prior art: a throwaway spike (branch `cs-12715-spike`) built and ran every part
of this against a live stack. Findings in that branch's
`docs/cs-12715-spike-findings.md`. **Everything below is either proven there or
explicitly flagged as unproven.** The spike's own code is not the deliverable —
several pieces were deliberately spike-grade and are listed as such.

---

## What the spike established

Recorded because it changes the plan and is not obvious from the ticket.

1. **The ambient shim is NOT sufficient.** A card that `extends` a catalog card
   _and_ declares a template fails `typeof X does not satisfy the constraint
'typeof BaseDef'` — the `any`-typed shim leaves the subclass's static side
   unresolvable, and `Component<typeof this>` requires `typeof BaseDef`. Every
   factory-built card ships templates, so this is the normal case. **Real types
   are required for card-level adoption; the shim only covers fields,
   components and commands.** This reverses "shim first, types later".

2. **Fetch-and-cache works and is cheap.** Against a live realm: 7 files, 62 KB,
   **257 ms**, 0 misses for the whole transitive graph of two entry modules.
   All four adoption shapes type-check clean against the fetched cache.

3. **`Accept: application/vnd.card+source` is load-bearing.** A plain GET
   returns _transpiled_ JS (66,915 bytes, decorators lowered to `dt7948.g(...)`,
   `createTemplateFactory` injected) versus 27,570 bytes of source. The
   transpiled form **resolves**, so the gate goes green while type-checking
   nothing — a silent false pass. It also blows the agent's own read limit
   (29,484 tokens) when it reads a module directly.

4. **One default run produced the target behaviour.** Two catalog references
   shipped in `contributor.gts` (`FeaturedImageField`, `ContactLinkField`),
   traceable to `REFERENCE` rows, passing lint / parse / evaluate / instantiate.
   Reuse decisions table: REFERENCE 2 · REUSE-BLOCKED 1 · GAP 1, zero
   base-realm imports miscounted. All four of the ticket's load-bearing rules
   held unprompted.

5. **Card-level adoption was refused, correctly.** Catalog `Author` was
   `REUSE-BLOCKED` with a named mechanism (welded to `blog-defaults`'
   `themeStyleFor` and the `.blog-scope` CSS scope, hero-image+quote isolated
   layout, `--blog-color-*` tokens); the agent then reused the two FieldDefs it
   composes. Confirms the ticket's prediction: **schema reuse survives a
   bespoke design language, template reuse does not.**

6. **Four separate defects would each have produced a null misread as model
   behaviour.** They are the substance of this PR as much as the feature is:

   | Defect                                                            | Effect if unfixed                          |
   | ----------------------------------------------------------------- | ------------------------------------------ |
   | `enableCatalogReuse` never read by the production backends        | run ships the **unlifted firewall**        |
   | `catalog-reuse`'s folded `description: >-`                        | `list_skills` advertises literally `>-`    |
   | boxel-cli `dist/index.js` unbuilt; preflight only checks `api.js` | the mandated catalog search **cannot run** |
   | `run-log.gts`'s stale `@ts-expect-error`                          | **every run starts parse-red**             |

   All four share one shape — declared in one place, not delivered on the path
   that executes. So does `SKILL_PRIORITY` (inert: nothing sets
   `maxSkillTokens`, and the resolver never names the skill) and the
   `boxel-ui-component-discovery` precedent, where `system.md` says "the skill
   below" and the skill is not below.

---

## Scope

### In this PR

Parse gate · flag + firewall + skill delivery · design→build contract · skills
pin bump.

### Folded in, first — commit 1

**Decided:** both land as commit 1 of this branch rather than a separate PR.
The interpolator fix is a hard prerequisite for any conditional work in
`system.md`, and splitting the branch costs more than the mixed history saves.
Each stays its own self-contained commit so either can be cherry-picked or
reverted alone.

- **`src/run-log.ts` stale `@ts-expect-error`** (one line). Every factory run
  seeds a realm whose parse gate is red from the start; the spike run burned 4
  of 8 iterations on it before shipping correct code. Land independently so it
  can be reverted or cherry-picked on its own, and so a reuse PR is not the
  reason a run-log fix is in the history.
- **The prompt interpolator's depth-blind `{{else}}` split.** Corrupts any
  nested conditional in any prompt today. Standalone correctness bug.

Both are small; they share commit 1.

### Deferred

Remix / the Spec→Listing shim (ticket Part 4 — land last, spin out if it
grows); scorer automation as CI; remote-realm and non-public-realm auth for the
resolver.

---

## Commit structure

Order matters for review, not just tidiness.

1. **`factory fixes: run-log parse gate + interpolator nesting`**
2. **`parse gate: resolve realm-prefixed imports`**
3. **`flag + firewall + skill delivery`**
4. **`prompts: bind reuse into the design→build contract`**
5. **`chore(skills): regenerate plugin skills at v0.1.4`** — last and alone

The regen spans **three tags** (`v0.1.1` → `v0.1.4`) and is a large mechanical
diff. Keeping it as its own commit lets a reviewer skip it wholesale instead of
hunting logic inside it.

**PR title needs a conventional-commit prefix** (`feat(skills): …`): the branch
touches `packages/boxel-cli/**` (`src/commands/parse.ts` and `plugin/skills/`),
which drives that package's npm version bump.

**Decided:** pin to `v0.1.4` and accept the three-tag drift, rather than cutting
a narrower `v0.1.5` upstream first. The regen is isolated in the last commit, so
a reviewer skips it wholesale; an upstream tag round-trip is not worth blocking
the branch on.

---

## 1. Parse gate

`packages/software-factory/src/parse-execution.ts` **and**
`packages/boxel-cli/src/commands/parse.ts` — both generate a tsconfig whose
`paths` map base/host/boxel-ui and **no realm prefix at all**. Fixing one leaves
the gate red through the other door: the agent runs `boxel parse` from Bash, and
that is the runbook's default local loop.

**Resolver.** Scan the files being parsed for realm-prefixed imports → fetch
each module's source **with `Accept: application/vnd.card+source`** → recurse on
its own relative and prefixed imports with a cycle set and bounded depth → write
into a cache dir inside the temp dir → point `paths` at the cache. Derive the
prefixes from `PREFIX_REALMS` (`runtime-common/realm-prefixes.ts`), not a
catalog special case.

**Degradation.** A fetch failure must not produce a red parse gate, or we have
rebuilt the original problem with a network dependency. Fall back to the
shorthand ambient module shim, log it, let the build proceed. Note the shim is
sufficient for field/component/command reuse and only loses card-level
adoption — degrading is not a cliff.

**Shim form matters.** Only the shorthand (bodiless) declaration works:

```ts
declare module '@cardstack/catalog/*' {
  const v: any;
  export default v;
} // named imports fail
declare module '@cardstack/catalog/*' {
  const v: any;
  export = v;
} // still fail under module: es2022
declare module '@cardstack/catalog/*'; // every import types as any
```

**Two traps.**

- `cachedTsconfigContent` is a module-level memo. Once `paths` depends on
  imports discovered in _this_ run, it is a correctness bug, not a stale cache.
- In `boxel-cli`, define the prefixes as **local literals**. Importing
  `runtime-common/realm-prefixes` drags type-only references into
  `@cardstack/base/*` and breaks that package's deliberately dependency-light
  `lint:types` (baseline-looking TS2307 noise; CI catches it).

**Cache keying:** realm URL + path + ETag / last-modified.

### Tests

- The four adoption shapes, red today:

  | Shape                                         | shim only | with real types |
  | --------------------------------------------- | --------- | --------------- |
  | extends catalog card, no template             | pass      | pass            |
  | **extends catalog card, with template**       | **fail**  | pass            |
  | base `CardDef` + catalog field, with template | pass      | pass            |
  | base `CardDef` + catalog field, no template   | pass      | pass            |

- **Fetched bytes are source, not transpiled.** This is the silent-false-pass
  guard: without it, a regression to a plain GET leaves every test green while
  type-checking nothing.
- A fetch failure degrades to the shim rather than failing the gate.

### Audit every other gate

Verified clean by the spike: `run_lint` (`no-literal-realm-urls` actively
rewrites literal catalog URLs _to_ the prefix), the imports step (host-tool
specifiers only), `run_evaluate`, `run_instantiate`, and the render gate.

**Unverified:** `boxel test` — `boxel-cli/src/lib/test-engine.ts` serves the
local workspace plus vendored `bundled-realms/` with no visible realm-prefix
resolution. Only bites under `--to-phase hardening`. Probe it; if it fails, it
belongs here.

---

## 2. Flag, firewall, skill delivery

### One flag, not two

**This departs from the ticket**, which says `enableCatalogReuse` and the
shipped `enableBoxelUiDiscovery` "coexist permanently". On inspection that
split does not survive:

- `enableBoxelUiDiscovery: true` is **hardcoded** at `factory-entrypoint.ts`.
  A flag that is always true is not a flag.
- The two skills describe each other as general and specialized forms of one
  discipline — `catalog-reuse` says "for UI primitives … use
  `boxel-ui-component-discovery` instead", and that skill points back up.
- Two flags admit a state the skill text contradicts: catalog reuse on,
  discovery off, and the agent is told to use a skill it was not given.
- Two flags means **nested** conditionals in `system.md` — the exact construct
  the interpolator silently corrupts (see the separate fixes PR). One flag
  removes a nesting level from the file that just proved fragile.

There _is_ a real axis here, but it is not the one the current flags draw. A
boxel-ui component spec is documentation: the resulting import is
`@cardstack/boxel-ui/...`, a shimmed package namespace and **not a realm** —
`realm-prefixes.ts` says it is "deliberately absent" from `PREFIX_REALMS`.
Catalog card/field reuse creates a genuine live cross-realm dependency in a
shipped artifact. So the principled distinction is _may I read the catalog_
versus _may I depend on it_, and neither existing flag expresses it. Splitting
on that axis is worth doing only if someone asks for it; splitting on
"components vs everything else" is not.

**Decided: one flag**, `enableCatalogReuse`, default on, sanctioning catalog
reads and selecting both skills. Remove `enableBoxelUiDiscovery`, keeping
`--enable-boxel-ui-discovery` as a deprecated no-op alias for one release if
anything external passes it.

**The counter-argument, recorded but not taken:** independent rollback. A single flag means
turning off a new, unproven behaviour also turns off a shipped, working one. If
that matters more than the simplification, keep two flags and accept the nested
conditional — but then fix the interpolator first, because the nesting is only
safe after that.

### Threading

**Thread `enableCatalogReuse`, default on** — `factory-entrypoint.ts`,
`factory-issue-loop-wiring.ts`, `factory-context-builder.ts`,
`factory-agent/types.ts`, **and both backends**
(`factory-agent/claude-code.ts`, `factory-agent/opencode.ts`).

> The spike added the flag to `AgentContext` and to `assembleSystemPrompt` —
> which is **test-only** (`factory-prompt-loader.ts`, called from `tests/` and
> `pnpm smoke:prompt`, never from production). The live path is
> `ClaudeCodeAgent.buildSystemPrompt`. Every `{{#if enableCatalogReuse}}` block
> rendered false and the run would have shipped the original firewall. Caught on
> the launch pad, by rendering the prompt — not by a test.

**Firewall (`prompts/system.md`).** With one flag the conditionals collapse to a
single level: sanction `Spec` queries across
`specType: card|field|component|command`, plus `Listing` and instance/file
searches, under `enableCatalogReuse`. The existing boxel-ui exception block
folds into that same block rather than keeping its own gate. The closing
sentence — _"This is the only sanctioned cross-realm read — do not extend it to
other catalog content"_ — is deleted outright, not made conditional: with one
flag there is no state in which it is true.

`{{catalogRealm}}` currently renders **only inside the boxel-ui conditional**.
The factory-side transport is `boxel search --realm <url>`, where `--realm` is
required, so the reuse path must render the URL too or the agent has a mandate
and no address. (`search-entries`, which the skill declares, is CS-12820 and
does not exist yet — `packages/host/app/tools/` has `search-cards`,
`search-and-choose`, no `search-entries`.)

**Delivery.** Name `catalog-reuse` in `DefaultSkillResolver.resolve()`'s lean
core and in the `issueType === 'design'` branch (that turn writes the binding
brand guide and currently receives neither the reuse skill nor the operations
skill). Both skills are selected by the one flag. Add `catalog-reuse` to
`SKILL_PRIORITY` adjacent to `boxel-ui-component-discovery` — necessary but
**not sufficient**: that list only orders an already-selected set, and
`maxSkillTokens` is never set by the wiring.

**Parser hardening — required.** `v0.1.4` ships `description: >-`, so
`skill-catalog.ts` renders the `list_skills` row as literally `>-`.
`build-skills.ts` mis-parses it identically for the generated README. Harden
both for folded YAML scalars; we do not control how skill authors write
frontmatter. (Fixing it upstream instead would need another tag.)

**Routing table.** Add a `catalog-reuse` row to `software-factory-operations`'s
"When you need X, read Y" table — and fix the drifted rows while there: every
`boxel-*` row points at `boxel-development` / `dev-*.md`, none of which exist, so
`read_skill` throws. One of those pointers is marked MANDATORY. Not this
ticket's bug, but it is the routing layer this ticket depends on.

### The ship-checklist test

**Render the system prompt through the real backend and assert the reuse block
is present.** Asserting the flag is set proves nothing — that is exactly what
would have passed while the run shipped the unlifted firewall. This one check
covers all four instances of the declared-but-not-delivered pattern, including
the boxel-ui precedent.

---

## 3. The design→build contract

The factory splits each card into a design turn and a build turn. The design
turn's only search instruction is target-realm-scoped; its hand-off carries the
schema implied by the mockup and is the build turn's **binding contract**. The
build turn then cannot adopt a catalog card without overturning that contract —
so adding catalog search "before authoring" is one turn too late.

### What the prompt owns, and what the skill owns

The prompt must **not** restate the skill's method. The skill lives in
`boxel-skills` behind a version pin and is shared with the in-app assistant; the
prompt lives here and is factory-only. Duplicating procedure across the two
means drift across two repos and a tag.

| The **skill** owns                                            | The **prompt** owns                                                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| how to query — filter shapes, `matches` semantics, broadening | _when_ in the turn: before the mockup, not after                                                               |
| what each `specType` entitles you to; per-type wiring         | the **artifact**: the Reuse decisions table and its columns                                                    |
| how to evaluate a hit (`readMe`, `ref`, `cardDescription`)    | the unblocking clause, which only means anything against the factory's own "no `.gts` in the design turn" rule |

The `-NOTES.md` contract is genuinely factory-specific — the assistant surface
has no notes file, no build turn, no binding hand-off. That is what the prompt
should own, and it is what the build turn and any future scorer consume.

This division only became available because `catalog-reuse` is now in the lean
core: the original reason to inline procedure — "the agent might never read the
skill" — no longer holds, since it is always in the system prompt.

**The one deliberate duplication:** the four rules below are restated in the
prompt as a short checklist, because they _are_ acceptance criterion 3. The
factory enforces them, so the factory states them — as criteria, not as
re-explained method.

### The edits

- **`prompts/issue-design.md`** — a REUSE step between §1 Ground and §2 DESIGN
  that fixes **ordering** and **output**, and defers method to `catalog-reuse`:
  enumerate the needs the issue implies (card first), consult the catalog per
  need _per the skill_, and record the decisions before designing. Widen §1's
  search from target-realm to target **and** catalog. Design _around_ the
  decisions — a referenced schema is a given, not a variable.
- **`prompts/issue-design.md` hand-off** — the `-NOTES.md` gains a **Reuse
  decisions** table: need → chosen `{module, name}` → wiring form (`adoptsFrom` /
  import + `contains` / `linksTo`) → or `GAP` with a reason. This is the
  load-bearing edit: it converts a finding into a term of the contract, and it
  is the part no skill can supply.
- **One unblocking clause**, or the turn self-blocks on its own prohibition:
  _naming a catalog module and its wiring form in the notes is required and is
  not card code._
- **`prompts/issue-build.md`** — the table joins what §2 implements and what the
  self-audit checks. Wire `REFERENCE` rows first; no adopted row may be silently
  replaced by a hand-written equivalent.
- **`prompts/issue-fix.md`** — the turn the ticket does not name, and the one
  that undid round 4's only correct reuse decision. Two edits: a gate failure is
  never resolved by deleting a reuse import (post `REUSE-BLOCKED` naming the gate
  and its error instead), and exempt `catalog-reuse` from "skip the general
  design skills", which today deselects the reuse skill in exactly the turn that
  reverts reuse.
- **`prompts/issue-implement.md`** — same reuse step, or a `--no-phase-split`
  run silently reverts to pre-change behaviour.
- **`prompts/issue-design-foundation.md`** — constrain the brand guide to tokens
  and positive direction. It is authored before any catalog awareness exists and
  its output is binding; one round's guide forbade icon treatments and killed the
  catalog `contact-link` field, the next refused it for rendering a boxel-ui
  `Pill`. A blanket prohibition on a rendering pattern is a defect the turn must
  justify.
- **`software-factory-operations` "Required flow"** duplicates the design-first
  sequence in prose. Leave it unedited and it contradicts the new prompts on the
  next run.

### Four rules, load-bearing regardless of whether the reuse rate moves

1. **Need #1 is always the card itself.** Told to enumerate "every card / field
   / component", the agent reads _the card_ as the artifact it is building and
   enumerates that card's **fields** — so a card-level adoption is never a row.
2. **Every hit received must be dispositioned** — adopted, or refused naming the
   mismatched fields or the design rule it breaks. The highest-value single
   change of the whole effort: it is what converted a silent drop into a
   readable decision and surfaced the parse-gate finding.
3. **Base-realm imports are not reuse.** Otherwise the metric self-inflates on
   `StringField` / `EmailField` / `ImageDef`.
4. **A blocked adoption is surfaced, not silently downgraded** — `REUSE-BLOCKED`
   plus a `post_update` naming the gate and its error. This is also the signal
   that a parse-gate regression has returned.

**Housekeeping:** any override prompt directory needs a `.prettierignore` entry
— the markdown formatter indents `{{/each}}` / `{{/if}}` and silently corrupts
Handlebars. `prompts/` is already listed.

---

## 4. Skills pin

Bump `BOXEL_SKILLS_VERSION` in `packages/boxel-cli/scripts/build-skills.ts` from
`v0.1.1` to **`v0.1.4`** (cut 2026-09-17, contains `catalog-reuse`; PR #124
merged the same day). Run `pnpm build:skills`, commit the regenerated
`plugin/skills/` as its own commit.

---

## Acceptance criteria

1. A hand-written card that adopts a catalog card **and** contains a catalog
   field passes every validation gate — locally and against a remote catalog
   realm. _(Local: proven in the spike. Remote: unproven, and the one piece of
   the resolver the spike could not exercise.)_
2. One default factory run against a corpus with known matches produces at least
   one catalog reference in the target realm traceable to a **Reuse decisions**
   row. _(Proven in the spike: two references.)_
3. Every hand-built definition is recorded as a `GAP` with a reason, every hit
   is dispositioned, and no base-realm import is counted as reuse. **This is the
   standing regression check** — enforceable independently of the reuse rate.
   _(Proven in the spike.)_
4. `enableCatalogReuse` defaults on and `catalog-reuse` appears in
   `SKILL_PRIORITY`.

   The ticket's fourth criterion also asks that "the `FACTORY_CATALOG_REUSE`
   scaffold is gone". **There is nothing to remove.** That identifier appears
   in no file on `main` and in no commit reachable from any ref (verified with
   `git log -S` across `--all` and `git grep` over the revision range). Treat
   that clause as void rather than as work.

---

## Verification protocol

Run in this order. **Each step that costs model tokens sits behind a step that
can kill it for free** — steps 1–5 spend nothing, only 7 and 8 do. This is the
sequence the spike actually followed; it is what turned four rounds of
"the agent declined to reuse" into six named defects.

Two rules carried over from the spike, because both were violated and both cost
a cycle:

- **Never judge a mechanism from a summary.** The spike's `run_parse` said
  `filesWithErrors: 1` and the card was clean — the failure was in a scaffold
  file. Re-run the check in isolation on the artifact you care about.
- **A green check on an unexercised path proves nothing.** Preflight reported
  zero missing prerequisites while the agent's only search transport was broken.

### Step 0 — Environment, and the traps in it

Every one of these bit the spike.

```zsh
# Dev stack: standard mode, from the MAIN checkout.
# With BOXEL_ENVIRONMENT unset the slug derives from the git branch, so starting
# from a worktree silently enters env-mode (vite lands on
# vite.<branch>.localhost:<random>, not 4200).
~/.boxel-golden/restore.sh --standard
mise exec -- pnpm -C packages/host start                                   # terminal 1
SKIP_CATALOG_UPDATE=1 REALM_SERVER_FULL_INDEX_ON_STARTUP=false mise run dev # terminal 2
```

- **Host first.** The realm-server polls the host and gives up if it 404s; if it
  dies there it never registers its Traefik route and every realm URL 404s.
- **`SKIP_CATALOG_UPDATE=1`** — the realm-server's startup runs
  `catalog-update.sh`, which does `git pull` inside `packages/catalog/contents`.
- **`REALM_SERVER_FULL_INDEX_ON_STARTUP=false`** — the golden image is warm;
  without this you pay a full reindex. Standard-mode `dev` only sets it for
  itself on the `INDEX_CACHE` path.
- **`dev`'s readiness gate is all-or-nothing across realms.** No
  `packages/catalog/contents/` → `/catalog/_readiness-check` never greens →
  `start-server-and-test` times out and takes the whole task down, host
  included. `catalog:setup` clones a 121 MB repo and **cannot resume**; copy it
  from a sibling checkout instead (`rsync -a --exclude .git`). A copied
  `contents/` has no `.git`, which is the second reason for
  `SKIP_CATALOG_UPDATE=1` — otherwise git walks up and pulls the _monorepo_.
- **Check the active profile before every run.** `boxel profile list`. It
  drifted to staging during the spike; a factory run would have created realms
  there.
- **`NODE_EXTRA_CA_CERTS=~/Library/Application Support/mkcert/rootCA.pem`** for
  anything invoking the CLI — its fetch otherwise rejects the localhost cert
  with a bare `fetch failed`.
- **Build the CLI and the host dist in the worktree:**
  `pnpm --filter @cardstack/boxel-cli build` (gives `dist/index.js`, which
  preflight does not check) and `pnpm --filter @cardstack/host build` (gives
  `packages/host/dist/tests/index.html`, the one real preflight prerequisite).

**Confirm the corpus answers before trusting any run.** The whole experiment
rests on a rank-1 hit:

```zsh
boxel search --realm https://localhost:4201/catalog/ --query '{"filter":{"on":
  {"module":"@cardstack/base/spec","name":"Spec"},"every":[{"eq":{"specType":"card"}},
  {"matches":"author"}]}}' --json
# expect: Author (@cardstack/catalog/7af9aa-blog-app/author#Author) at rank 1
```

### Step 1 — Pre-flight gate audit, by hand, no agent

Hand-author the intended artifact — a `.gts` that **adopts a catalog card AND
contains a catalog field, with a template** — plus an instance, and drive it
through every gate individually, recording the exact error for each:

`run_parse` · `boxel parse` · `run_lint` / `boxel lint` · `run_evaluate` ·
`run_instantiate` · imports step · render gate · a trivial `.test.gts` through
`boxel test` · realm indexing + Spec.

Output is a gate → verdict → error table. Costs nothing, and it is the audit the
original feasibility probe skipped — which is how the parse gate survived four
rounds. Expected from the spike: parse fails in both implementations; lint,
imports, evaluate, instantiate and render pass; `boxel test` unknown.

**Kill criterion:** no prompt work matters until this table is green.

### Step 2 — The four shapes

The template is what breaks card adoption, so all four must be asserted
separately:

| #   | Shape                                         | shim only | real types |
| --- | --------------------------------------------- | --------- | ---------- |
| A   | extends catalog card, **no template**         | pass      | pass       |
| B   | extends catalog card, **with template**       | **fail**  | pass       |
| C   | base `CardDef` + catalog field, with template | pass      | pass       |
| D   | base `CardDef` + catalog field, no template   | pass      | pass       |

A alone passes under the shim, so **a probe that only tests A concludes the shim
works.** The spike's first probe did exactly that.

### Step 3 — Source, not transpiled

Assert the fetched bytes are source. Same module, two ways:

```
GET …/author.gts                                    → 66,915 bytes, dt7948.g(...) lowered JS
GET …/author.gts  Accept: application/vnd.card+source → 27,570 bytes, == the file on disk
```

The transpiled form **resolves**, so without this assertion a regression leaves
every test green while type-checking nothing.

### Step 4 — Interpolator cases

Five cases, and the third is the one that matters:

| template                              | expected                     |
| ------------------------------------- | ---------------------------- |
| flat if/else                          | `AFB`                        |
| nested if, no inner else, true branch | `ATB`                        |
| **nested if-ELSE, true branch**       | `ATNB` (was `AT{{#if y}}YB`) |
| nested if-else, false branch          | `ANB`                        |
| two sibling ifs                       | `AXMYB`                      |

### Step 5 — Delivery probe, no agent run

- `catalogSkills()` → the `list_skills` row reads "MANDATORY before writing any
  `.gts`…", **not** `>-`.
- `readSkillOnDemand('catalog-reuse')` resolves; every routing-table pointer in
  `software-factory-operations` resolves too (they do not today).
- `DefaultSkillResolver.resolve()` names `catalog-reuse` for an implementation
  issue **and** for `issueType === 'design'`.
- **Render the system prompt through the real backend** (`buildSystemPrompt`, not
  `assembleSystemPrompt`) in both flag states, and assert the reuse block is
  present and no `{{` survives. This is the check that would have caught the
  unwired flag; asserting the flag is set would not.

### Step 6 — Suite

`pnpm test:node` in `packages/software-factory`. Baseline on a fresh worktree is
**3 environmental failures**: two `factory-entrypoint integration` tests needing
`packages/host/dist/tests/index.html`, and one `port-allocator` test that fails
while a dev stack holds ports. Anything beyond those three is ours.

### Step 7 — Live-turn probe, one issue

The cheapest real run: does an agent that _has_ the skill query the catalog and
write a reuse decision? Capture `--debug` to a file. There is no `--issue`
filter, so scope by seeding the control realm with a single issue rather than
paying for bootstrap + design-foundation + N cards.

Read the log for: a catalog query **before** any mockup file exists, the card
enumerated as a need (not just its fields), and a Reuse decisions table in
`design/<slug>-NOTES.md`.

### Step 8 — One full default run

On a blog-shaped brief whose vocabulary **differs** from the catalog's — describe
a "contributor" with a name, bios, an email, links out and a portrait, and never
write the word _author_. A brief that names the catalog's types tests lexical
matching, not reuse. Include one card with **no** catalog equivalent (an
editorial calendar) as the control: if that comes back as reuse, the contract is
being gamed rather than followed.

Then score criteria 2 and 3 mechanically, not by reading:

```zsh
# catalog references in shipped .gts, base realm excluded
grep -rn "@cardstack/catalog/" "$WORKSPACE" --include="*.gts" | grep -v /design/
# reuse rows by disposition, per card
grep -cE "^\| .*\| *(REFERENCE|REUSE-BLOCKED|GAP) *\|" "$WORKSPACE"/design/*NOTES.md
# base-realm imports miscounted as reuse (must be 0)
grep -n "cardstack.com/base" "$WORKSPACE"/design/*NOTES.md | grep -c REFERENCE
```

**Expected shape of a pass** (what the spike got for one card): 2 catalog
references in `.gts`; REFERENCE 2 · REUSE-BLOCKED 1 · GAP 1; 0 base-realm
miscounts; lint/parse/evaluate/instantiate green on the card itself.

A `REUSE-BLOCKED` or `GAP` row is **not** a failure — the ticket is explicit that
a reasoned refusal satisfies criterion 3. The failures are: an undispositioned
hit, a hand-built definition with no `GAP` row, a base-realm import counted as
reuse, or a reuse decision that vanishes between the notes and the `.gts`.

### What this protocol cannot cover

Recorded so it is not mistaken for proven: remote-realm fetch-and-cache,
non-public-realm auth, cache keying under ETag change, and `boxel test` with a
cross-realm import under `--to-phase hardening`.
