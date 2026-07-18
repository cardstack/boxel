# `factory-v2-experiment` — what this branch changes vs `main`

This document explains what the `factory-v2-experiment` branch adds on top of
`main`, why, and how each piece works. It is written for a reviewer deciding
whether/how to merge, and for anyone operating the factory who needs to know
what changed.

`main` ships the factory as originally documented in [`README.md`](../README.md):
an issue-driven agentic loop that takes a **brief card**, bootstraps a Project +
Issues, and builds a Boxel card family with a 5-step validation pipeline
(parse · lint · evaluate · instantiate · test).

This branch keeps that skeleton and layers on three things:

1. **v2 — a lean, design-first build loop** that produces cards good enough to
   ship, with a live "run log" the operator watches.
2. **v3 — a control/product realm split, a GitHub-repo port flow, and
   render-gated acceptance** so a run can start from a real app and be judged on
   pixels, not claims.
3. **Operational hardening** — resume-safe restarts, cheaper agent turns through
   session reuse, a bug-fix fast path, and a run log that behaves like a real
   activity feed.

---

## The aim

The one-line goal: **turn "here is an app (or a brief)" into a coherent,
inspectable Boxel card family, unattended, and let a human watch and trust the
process.** Everything below serves one of three sub-goals:

- **Quality** — cards that look designed and compose cleanly (design-first loop,
  phase-split budgets, render gate).
- **Trust & observability** — the operator can see, at any moment, what the
  factory is doing and why (the run log, RunMonitor, activity entries).
- **Robustness & cost** — a run survives interruption, doesn't redo finished
  work, and doesn't burn tokens re-reading what it already read (resume guard,
  session reuse, control/product split).

---

## Area 1 — v2: the lean, design-first build loop

**What.** A `--v2` mode for `factory:go` that reorders each implementation turn
to **design first**: the agent writes a single self-contained HTML mockup with
realistic sample copy, screenshots it, critiques and revises it, and only then
translates the accepted mockup into a `.gts` card. v2 also drops the QUnit/test
requirement from the build loop (tests are a later hardening phase).

**Why.** The pre-v2 loop produced schema-correct but pedestrian cards — fitted
views drowning in chrome, weak hierarchy. Deciding the look *before* writing
templates, on a cheap HTML surface, is where taste lives.

**How.** `issue-implement-v2` / `issue-design-v2` / `issue-build-v2` prompts; a
`screenshot_html` tool that renders a workspace HTML file in headless Chromium
and returns a PNG the agent then `Read`s and critiques; on-demand skill tools so
the agent pulls only the design/format skills an issue actually touches.

## Area 2 — the run log (live activity feed)

The run log is a Boxel card in the realm that the operator opens to watch a run
unfold. It went through the largest evolution on this branch.

**What & why.** A live "blog" of the run — every milestone (design round,
validation, card shipped, issue picked/done), the agent's own `post_update`
commentary, and orchestrator narration — streamed onto a card as it happens, so
a long agent turn never leaves the operator staring at silence.

**How it works now (the current model):**

- **Query-backed Posts, not a `containsMany` array.** Each entry is its own
  `RunLogEntry` card; the isolated view is a `@context.searchResultsComponent`
  query (`sort seq desc`), and count tiles are `page:{size:1}` queries reading
  `results.meta.page.total`. This stops run-log churn from invalidating the
  product realm's index and scales past the array model's limits.
- **Reveal-on-scroll feed** (the `workspace.gts` activity-feed pattern): one
  100-cap query, the template reveals 20 rows at a time as a bottom
  `IntersectionObserver` sentinel scrolls into view — light initial DOM, no
  re-query per reveal.
- **Non-shifting live updates.** New entries arrive at the head of a live run;
  rendering them would shove the reader's content down. Instead they are
  *buffered* (held out of the DOM) behind a subtle sticky "↑ N new" pill and
  only revealed on click (or automatically when the reader is already at the
  top). Because buffered entries are never rendered, nothing on screen moves.
- **Comment + status-change entries.** In the `containsMany` days, issue
  comments and status transitions were just pushed onto the array. The query
  model's equivalent is to **emit one `RunLogEntry` per event** — so agent
  comments (`post_update`), orchestrator/reviewer comments (`emitComment`), and
  every state transition (`emitStatusChange`, plus the bespoke `issue-picked` /
  `issue-done` / `blocked` milestones) show in the feed. Status *history* has to
  be captured at emit time because the Issue card stores only its current
  status.
- **Rich links.** `post_update` bodies render as Boxel Flavored Markdown; the
  agent references a card by its workspace path and picks the form (inline atom
  `:card[…]`, embedded `::card[…]`, or a sized `fitted` tile), and the run log
  resolves the path to a live card URL with the right (control vs product) realm
  routing. Entries link their issue via a light atom chip.
- **Durable design history.** HTML mockups the agent writes to scratch `design/`
  are copied into `design-history/` alongside the flattened PNG, so a run-log
  entry's image link survives the agent tidying up `design/`.

## Area 3 — per-turn model/effort budget + phase-split

**What.** An orchestrator-owned policy that assigns a model + reasoning-effort
budget per turn *type*, and a phase-split that runs the DESIGN turn on the
flagship model and the BUILD (translation) turn on a cheaper one, forked from
the design session.

**Why.** Taste work (design) deserves the strong model; mechanical translation
and later fix iterations don't. Spending flagship tokens on every turn is waste.

**How.** `modelPolicy` (bootstrap / build / fix budgets); on iteration 1 of a
non-meta issue, a DESIGN turn then a BUILD turn that resumes the design turn's
session so the accepted design carries over without re-reading.

## Area 4 — context forking & inner-loop session reuse

**What.** A run primes one session (skills + design language + precedent) and
**forks** it for every implementation turn, so the expensive static context is
read once and served from the provider prompt cache. On top of that, the inner
fix loop **chains**: after iteration 1, a fix turn resumes the *prior
iteration's* session instead of re-forking prime.

**Why.** Two different wins. Forking prime shares the cached static prefix.
Chaining keeps the *working* files the agent already read in context, so a fix
iteration is "here's what validation flagged, fix it" — no re-read, no
re-orient. That was the dominant cost in the 3–4-minute fix turns.

**How.** `decideSessionStrategy` makes the call per turn: **continue** the prior
session while the fix is converging; go **fresh** (re-fork prime) when the same
failure repeats with no progress, or after a chain-length cap — bounding context
growth, anchoring risk, and keeping the resumed prefix inside the cache window.
Progress is measured by a `failureFingerprint` (which validation steps failed +
total error count).

## Area 5 — v3: control/product realm split

**What.** With `--control-realm`, one local workspace syncs to **two** realms:
the **product** realm (the built cards — the deliverable) and the **control**
realm (issues, board, knowledge, validation artifacts, and the run log).

**Why.** Run-log/validation churn was invalidating the product realm's index
(the live-surface "flashing Loading…" failure), and product `.gts` edits were
nuking the loader under the run-log/issue cards the operator was watching.
Separating them makes each side stable. Control-plane cards also sync via raw
per-file writes, which never go through `/_atomic?waitForIndex=true` (a platform
path that silently strips `containsMany` FieldDef data), so the control plane is
structurally immune to that corruption.

**How.** `control-plane-sync.ts` owns the control paths; a factory-managed
`.boxelignore` keeps them out of the product atomic sync (and refreshes a stale
managed block when the control-path set changes).

## Area 6 — v3: GitHub-repo port flow

**What.** `--repo-url` points the factory at a real GitHub app instead of a
brief card. A **PORT-ANALYSIS** issue runs *before* bootstrap: it clones the
repo, reads its README/media **and its code**, and writes two Knowledge
Articles — a product view (features, screens, flows, a "better than the
original" rubric, proposed card-family mapping) and an engineering view
(architecture, dependency map with Boxel-side answers, specialized logic incl.
verbatim AI prompts, the real data model, and a ported test contract).
Bootstrap then plans the card family from those articles.

**Why.** Porting an app well means understanding how it actually works, not just
skimming a README — including what its tests pin down and what fixtures they use.

## Area 7 — v3: render gate + acceptance walkthrough

**What.** After an issue ships, the orchestrator screenshots the real host
render of the cards it produced, and a verifier turn judges every acceptance
criterion **against the pixels** — a criterion passes only on a visible, working
affordance. Failures are filed as `defect` issues.

**Why.** "The command class exists" is not shipping a feature. Judging on real
renders closes the gap between "code written" and "capability the user can see."

## Area 8 — v3: host-import manifest gate

**What.** A generated catalogue of the host tools/imports available in this
checkout, fed to both the agent's context and a static `imports` validation
step, so agent code can't drift from the real host contract.

## Area 9 — RunMonitor (orchestrator narration)

**What.** An orchestrator-side monitor that authors its own run-log entries —
stall narration, scheduler notes, watchdog observations, and per-turn
cost/duration telemetry — so the feed reflects orchestration decisions, not just
the agent's voice.

## Area 10 — restart & resume safety (this batch)

**What.** Two fixes so a restarted run picks up where it left off instead of
redoing finished work.

- **Seed resume guard.** On restart the control realm is pulled first, so seeds
  a prior run completed are present as `done`. The seeder now *leaves a done
  seed intact* when it belongs to the current brief (matched by the brief's
  source/repo URL), instead of re-arming it to `backlog`. A changed brief still
  re-arms (the sequential multi-brief pass). This stopped the factory from
  re-running the PORT-ANALYSIS repo study on every restart.
- **Authoritative-status reconciliation.** The scheduler picks from the realm
  *index*, which lags the control-plane's raw writes. Before running a picked
  issue, the loop re-reads its status from the authoritative local workspace
  file (`readLocalStatus`); if the file says `done`, the index was stale — skip
  it. A genuinely interrupted issue reads `in_progress` locally too, so real
  resumable work is never skipped.

## Area 11 — bug-fix fast path (this batch)

**What.** Defect/bug issues skip the design round entirely.

**Why.** A defect on a card that already shipped needs a diagnose-and-fix turn,
not a fresh HTML-mockup-and-critique design round. A restart was observed
running a full design round on a render-crash defect — wasted work.

**How.** `isBugFixIssue` (matches `defect`/`bug`/`regression`/`hotfix`/`fix`)
excludes the issue from the phase-split DESIGN turn and routes it to a dedicated
`issue-fix-v2` prompt: reproduce → locate → root cause → minimal fix → verify,
with an explicit "do NOT run a design round" instruction.

## Area 12 — infrastructure hardening

- **Content-hash workspace fingerprint** (`validation-run-cache.ts`). The sync
  gate keyed on `size|mtime`; a bidirectional pull rewrites identical files with
  a fresh mtime, so every run did full no-op syncs. Hashing file *content*
  instead gives a stable fingerprint → unchanged content skips the sync.
- **Per-turn agent tool telemetry** (`agent-tool-telemetry.ts`). One terse line
  per tool call plus a per-turn waste summary (duplicate reads, whole-file
  rewrites, screenshot thrash, mutating shell) so wasteful agent behavior is
  visible.
- **Transient-agent-error classification** (`transient-agent-error.ts`) so a
  network/API blip is retried rather than failing the run.
- **Instance discovery** (`instance-discovery.ts`) — newest product instances on
  disk, used as a render-gate fallback when a turn wrote no instances.
- **Workspace skills** (`workspace-skills.ts`) — load workspace-authored skills
  into the agent context.

---

## Testing

Every area ships unit tests (node's test runner / QUnit). Current status of the
touched suites, all green:

| Suite | Focus |
|---|---|
| `issue-loop` | session chaining, `decideSessionStrategy`, reconciliation, bug-fix gating |
| `factory-seed` | resume guard (fresh / same-brief / changed-brief) |
| `issue-scheduler` | `readLocalStatus`, blockedBy resolution, type filter |
| `run-log` | Posts model, migration/pruning, BFM directive resolution, HTML preservation |
| `factory-prompt-loader` | `isBugFixIssue`, fix-vs-design prompt routing |
| `control-plane-sync` | hash-gated push, selective pull, stale-block refresh (run via `node --test`) |
| `validation-run-cache` | content-hash fingerprint stability |
| `agent-tool-telemetry`, `instance-discovery`, `transient-agent-error`, `factory-context-builder`, `factory-agent-claude-code` | supporting infra |

Note: `control-plane-sync.test.ts` uses the `node:test` runner; run it with
`node --test` (running it under the qunit harness reports a spurious global
failure while node:test reports pass).

## Where things live

| Concern | File(s) |
|---|---|
| Loop, phase-split, session reuse, bug-fix gating, comment/status emit | `src/issue-loop.ts` |
| Prompt routing, `isBugFixIssue` | `src/factory-prompt-loader.ts`, `prompts/*` |
| Seed resume guard | `src/factory-seed.ts` |
| Scheduler, `readLocalStatus` | `src/issue-scheduler.ts` |
| Run-log card + feed + BFM resolver | `src/run-log.ts` |
| Agent invocation, forking, caching | `src/factory-agent/claude-code.ts` |
| Tools (post_update BFM teaching, screenshot_html) | `src/factory-tool-builder.ts` |
| Control/product split | `src/control-plane-sync.ts`, `src/factory-entrypoint.ts` |
| Sync fingerprint | `src/validation-run-cache.ts` |
