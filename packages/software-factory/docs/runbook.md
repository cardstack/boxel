# Interactive Factory Runbook

A user runs the software factory entirely from inside a logged-in
Claude Code session by pasting **one prompt** that drives the
agent through bootstrap, per-issue implementation, validation, and
project completion in a single end-to-end loop. There is no
orchestrator process; the agent does every step itself.

## Prerequisites

The user has done the following outside Claude Code:

- Installed `boxel-cli` and run `boxel profile add` so the active
  profile points at the target realm server. `boxel profile list`
  shows the active profile.

  **Phase 1 dev setup note.** During Phase 1 the `boxel` CLI is
  not always available as a globally-installed binary. The dev
  binary lives at
  `<monorepo>/packages/boxel-cli/bin/boxel.js` — symlink it onto
  your PATH:

  ```bash
  cd /path/to/boxel/packages/boxel-cli
  pnpm build                                          # build fresh dist/
  ln -sf "$(pwd)/bin/boxel.js" ~/.local/bin/boxel     # or any PATH dir
  boxel --version                                     # confirm
  ```

  If `packages/boxel-cli/dist/` exists but is **stale** (older
  than the validator-CLI commits on this branch), `boxel lint` /
  `parse` / `test` will be missing. Either rebuild (`pnpm build`)
  or rename `dist/` to `dist.stale/` so the bin shim falls back to
  the live TS source.


- Installed Claude Code and run `/login` so the session is
  subscription-billed. `ANTHROPIC_API_KEY` is **not** set in the shell
  Claude Code launched from (it would override subscription auth — see
  the auth precedence in the Claude Code docs).
- A running realm server reachable at the URL they intend to use. For
  local work that is `mise run dev-all` in the boxel monorepo; for
  staging/prod they have credentials in their profile.
- The host app's `dist/` is built (needed by `boxel test`):
  `pnpm --filter @cardstack/host build`.
- Playwright's headless Chromium is installed (also for `boxel test`):
  `npx playwright install chromium`. One-time per machine.
- An empty local directory chosen as the workspace. Claude Code is
  launched with that directory as cwd.

The user also knows:

- The **brief URL** — a card in the source realm describing what to
  build (e.g. `http://localhost:4201/software-factory/Wiki/<brief-slug>`).
- The **target realm URL** they want the factory to create
  (e.g. `http://localhost:4201/<username>/<realm-name>/`).

## The prompt

A single prompt drives the entire run. The agent bootstraps the
realm, then loops through the implementation Issues it created,
implementing each one through validators + validation cards until
no eligible Issues remain. The user pastes it once and lets the
session run.

```
Run the software factory on this brief:

  Brief URL:    <BRIEF_URL>
  Target realm: <TARGET_REALM_URL>
  Workspace:    <LOCAL_WORKSPACE_DIR>

Follow docs/interactive-runbook.md end-to-end:

1. Wire up the dev `boxel` CLI (per the software-factory-bootstrap
   or software-factory-scheduling skill — first action).
2. Create the target realm at the URL above and pull it into the
   workspace.
3. Read the brief and follow software-factory-bootstrap to write
   the Project, IssueTracker, Knowledge Articles, one Issue per
   entry-point card the brief describes, plus the bootstrap-seed
   Issue. Push the workspace.
4. Hand off to software-factory-scheduling: pick the next
   unblocked Issue, follow software-factory-operations to
   implement it (.gts + .test.gts + sample instances + Catalog
   Spec), then iterate the validator loop:
     a. Run all five validators against the realm.
     b. After each one, write a
        `Validations/<type>_<issue-slug>-<n>.json` artifact card
        capturing the result (passed or failed).
     c. If any validator failed, fix the source, push, and
        re-run the failing validator(s). Write new artifact
        cards with the next sequence number — do NOT overwrite
        the previous ones.
     d. Repeat (a)–(c) until every validator returns
        `status: "passed"`. Only then mark the Issue `done`.
5. Loop step 4 until no eligible Issues remain.
6. When the backlog is empty and every Issue is done, set the
   Project's `projectStatus` to "completed" and push.

Stop and report only if you hit something genuinely unrecoverable
(e.g. the brief is ambiguous beyond your scope, or a validator
failure you can't diagnose). Otherwise, complete the project in
this one session.
```

> **Working through multiple prompts instead.** If you'd rather
> drive the run interactively — pausing between bootstrap and
> implementation, or between each Issue — paste the single prompt
> above and ask the agent to stop after each phase. The skills
> support both modes; the single-prompt form is the default
> because the recipe brief proved it works end-to-end without
> intervention.

## What the agent calls (and from where)

| Capability                | How the agent invokes it                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Realm creation            | `boxel run-command create-realm` (or `boxel realm create`)                          |
| Workspace pull / push     | `boxel realm pull <url> <dir>` / `boxel realm push <dir> <url>` (realm-sync skill)  |
| Federated search          | `boxel search --realm <url> --query '<json>'` (boxel-api skill)                     |
| Card-type schema          | `boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default --realm <url> --input '{"codeRef":{"module":"...","name":"..."}}'` |
| Lint                      | `boxel lint [path] --realm <url>` (whole-realm or single-file)                      |
| Parse / type-check        | `boxel parse [path] --realm <url>` (monorepo-only — glint + JSON validation)        |
| Evaluate module           | `boxel run-command @cardstack/boxel-host/commands/evaluate-module/default --realm <url> --input '{"moduleIdentifier":"<abs-url>","realmIdentifier":"<abs-url>"}'`  |
| Instantiate card          | `boxel run-command @cardstack/boxel-host/commands/instantiate-card/default --realm <url> --input '{"moduleIdentifier":"<abs-url>","cardName":"...","realmIdentifier":"<abs-url>","instanceData":"<json>"}'` |
| Run QUnit tests           | `boxel test --realm <url>` (monorepo-only — drives headless Chromium)               |
| Read transpiled output    | `boxel read-transpiled <path> --realm <url>` (for debugging eval/instantiate errors) |
| Write files               | native `Write` / `Edit`                                                             |
| Read / search workspace   | native `Read` / `Glob` / `Grep`                                                     |

There are no factory MCP tools. `signal_done` and
`request_clarification` are replaced by writing the issue's `status`
field directly (`done` / `blocked`) and appending to its `comments[]`
array.

## Gaps blocking Phase 1

### CLI commands to add to `boxel-cli`

All three validator CLIs have been added; the only remaining work is
skill content. The commands and their constraints:

1. **`boxel lint [path] --realm <url>`** — runs ESLint + Prettier
   with the `@cardstack/boxel` config via the realm's `_lint`
   endpoint. Without a path, lints every `.gts` / `.gjs` / `.ts` /
   `.js` file in the realm; with a realm-relative path, lints just
   that file. Works against any realm (no monorepo dependency).
2. **`boxel parse [path] --realm <url>`** — runs glint (`ember-tsc`)
   over `.gts` / `.gjs` / `.ts` files and validates the document
   structure of any `.json` files linked as `Spec.linkedExamples`.
   **Monorepo-only**: type-path mappings (`packages/base`,
   `packages/host`, `packages/boxel-ui`) and the `ember-tsc` binary
   are resolved relative to this CLI's location. Not usable from a
   published `boxel-cli` outside the monorepo. Long-term, the right
   shape is a realm-server `_parse` endpoint mirroring `_lint`; that
   is deferred as a separate Phase 2 ticket.
3. **`boxel test --realm <url>`** — runs the realm's QUnit suite by
   driving headless Chromium against the host app's compiled
   `dist/`. **Monorepo-only** for the same reason as parse: the
   host dist directory is discovered relative to this CLI (or via
   `TEST_HARNESS_HOST_DIST_PACKAGE_DIR`). The host app must have
   been built (`pnpm --filter @cardstack/host build`) before
   running.

The other validators (`evaluate`, `instantiate`) and `get-card-schema`
are already host commands reachable via `boxel run-command`. Optional
sugar (`boxel evaluate`, `boxel instantiate`, `boxel get-card-schema`)
would shorten the skill text but is not blocking.

### Skill content to add / rewrite

1. **`software-factory-bootstrap`** — exists, needs rewrite:
   - Drop references to `signal_done`, `get_card_schema`,
     `request_clarification`.
   - Replace `get_card_schema(...)` calls with
     `boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default ...` (with the module+name wrapped in `codeRef`).
   - Add a "creating the target realm" section (currently the
     orchestrator does this before the agent runs).
   - Add the **tracker module URL discovery** rule. Today the
     orchestrator inferDarkfactoryModuleUrl()s it and puts it in the
     system prompt. The agent needs to discover it itself — typically
     `<source-realm>/darkfactory` published from the
     `packages/software-factory/realm` source realm, but the agent
     should confirm via `boxel search` or by reading the brief's
     containing realm.

2. **`software-factory-operations`** — exists, needs rewrite:
   - Drop the `run_*` factory-tool descriptions; replace with the
     `boxel lint/parse/test/run-command evaluate-module/...` CLI
     forms.
   - Drop `signal_done` / `request_clarification`; describe writing
     `status: "done"` (after validators pass) or `status: "blocked"`
     plus a comment.
   - Drop the "do not set status to done" rule — the agent owns that
     transition now.

3. **`software-factory-scheduling`** — new. Picks the next unblocked
   issue from a realm. Encodes the rules currently in
   `packages/software-factory/src/issue-scheduler.ts`:
   - Eligibility: status in {`backlog`, `in_progress`}, every blocker
     has status `done`.
   - Ordering: `in_progress` first, then priority
     (critical > high > medium > low), then `order` ascending.
   - Status transitions the agent now performs: backlog →
     in_progress on pickup; in_progress → done on validation pass;
     in_progress → blocked when stuck.

4. **`software-factory-context`** — new (or fold into scheduling).
   How to traverse an issue's `project` and `relatedKnowledge`
   relationships to load the Project card and Knowledge Article
   bodies for context. Currently
   `packages/software-factory/src/factory-context-builder.ts`.

### Phase 1 includes validation artifact cards

After each validator runs, the agent writes a corresponding card
into the target realm's `Validations/` folder — `LintResult`,
`ParseResult`, `EvalResult`, `InstantiateResult`, `TestRun`. This
gives the human a sortable audit trail in the Boxel host UI,
matching what the SDK orchestrator produced. The card types,
filename conventions (`Validations/<type>_<issue-slug>-<n>.json`),
and schema-discovery flow are documented in the
`software-factory-operations` skill.

### Things explicitly NOT in Phase 1

- **Retry semantics on blocked issues.** The orchestrator's
  `--retry-blocked` flag is moot; the user (or Phase 2 automation)
  decides whether to re-prompt on a blocked issue.
- **Iteration limits.** The orchestrator caps inner iterations at 8 and
  outer cycles at 50. Phase 1 puts the user in charge of stopping;
  Phase 2 can re-introduce limits.

## What follow-up work looks like

The single-prompt form proved out the loop, which means a few of
the rough edges that remain are now Phase 2 / follow-up work:

- **`/factory-run` slash command** — wrap the single prompt above
  as a slash command (or a `boxel factory run` CLI that spawns
  `claude` with the prompt baked in) so the user doesn't paste
  prose every time.
- **Realm-server `_parse` endpoint** — replace the monorepo-bound
  `boxel parse` with a server-side endpoint mirroring `_lint`, so
  the published `boxel-cli` can lint AND parse without checking
  out the repo.
- **Dev `boxel-cli` setup automation** — the ~30 lines of bash the
  agent runs at the start of every session (find monorepo, rename
  stale `dist/`, symlink to PATH) should collapse into a single
  per-machine prerequisite, not per-session boilerplate.
- **Orchestrator retirement** — once Phase 1 has shipped and run
  in production for long enough, delete `issue-loop.ts`,
  `factory-agent/`, etc.

## Expected output

A successful run produces, in the target realm:

- `Projects/<slug>.json` — the Project card (`projectStatus` ends
  up at `completed`).
- `Boards/<slug>.json` — the IssueTracker board linked back to the
  Project.
- `Knowledge Articles/<slug>-brief-context.json` and
  `<slug>-agent-onboarding.json` — at minimum; more if the brief
  warrants.
- `Issues/bootstrap-seed.json` — the bootstrap anchor Issue
  (status `done`, issueType `bootstrap`).
- `Issues/<slug>-<card-name>.json` — one Issue per entry-point
  card the brief describes (status `done` once implemented).
- `<card-name>.gts` and `<card-name>.test.gts` — the card
  definition and its co-located QUnit tests.
- `<CardType>/<instance>.json` — one or more sample instances.
- `Spec/<card-name>.json` — the Catalog Spec card linking the
  sample instances via `linkedExamples`.
- `Validations/lint_<issue-slug>-<n>.json`,
  `parse_…`, `eval_…`, `instantiate_…`, `test_…` — one validation
  artifact card per validator per iteration (sequence numbers
  increment on retry; old cards are kept).
