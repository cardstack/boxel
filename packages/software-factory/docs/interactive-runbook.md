# Interactive Factory Runbook (Phase 1)

A user runs the software factory entirely from inside a logged-in Claude
Code session by issuing the prompts in this document, in order. There is
no orchestrator process; the agent does every step itself.

> **Status:** draft — this is the Phase 1 spec for CS-11149. It
> documents the target user experience. The gaps section at the bottom
> tracks what is still missing (CLI commands, skill content) before the
> prompt sequence works end-to-end against the sticky-note brief.

## Prerequisites

The user has done the following outside Claude Code:

- Installed `boxel-cli` and run `boxel profile add` so the active
  profile points at the target realm server. `boxel profile list`
  shows the active profile.
- Installed Claude Code and run `/login` so the session is
  subscription-billed. `ANTHROPIC_API_KEY` is **not** set in the shell
  Claude Code launched from (it would override subscription auth — see
  the auth precedence in the Claude Code docs).
- A running realm server reachable at the URL they intend to use. For
  local work that is `mise run dev-all` in the boxel monorepo; for
  staging/prod they have credentials in their profile.
- An empty local directory chosen as the workspace. Claude Code is
  launched with that directory as cwd.

The user also knows:

- The brief URL (e.g. `http://localhost:4201/software-factory/Wiki/sticky-note`).
- The target realm URL they want the factory to create
  (e.g. `http://localhost:4201/<username>/<realm-name>/`).

## The prompts

Three prompts. The user pastes each one into the same Claude Code
session. Prompt 2 is run once per issue the agent created; the user
keeps issuing it until Claude reports there are no unblocked issues
left.

### Prompt 1 — Bootstrap

```
I want to run the software factory on this brief:

  Brief URL:    <BRIEF_URL>
  Target realm: <TARGET_REALM_URL>

Please:

1. Create the target realm at the URL above using boxel-cli.
2. Initialize my cwd as the local workspace mirror of that realm.
3. Read the brief from the source realm.
4. Follow the software-factory-bootstrap skill to create the Project,
   IssueTracker, Knowledge Articles, and one Issue per entry-point
   card described in the brief. Use the live card-type schemas (fetch
   them via `boxel run-command get-card-type-schema`) — do not guess
   field names.
5. Push the workspace to the target realm.
6. Stop and report what you created. Do not start implementing any
   issue yet.
```

### Prompt 2 — Work the next issue

```
Now work the next unblocked issue. Follow the
software-factory-scheduling skill to pick which one:

- Search the target realm for Issue cards.
- Eligible = status is "backlog" or "in_progress", and every Issue in
  the issue's `blockedBy` relationship has status "done".
- Among eligible issues, prefer in_progress, then higher priority
  (critical > high > medium > low), then lower `order`.

Once you have picked one:

1. Set its status to "in_progress" and sync the workspace.
2. Load the linked Project and `relatedKnowledge` articles for context.
3. Follow the software-factory-operations skill to implement the issue.
   Write .gts, .test.gts, card instances, and the Catalog Spec card.
4. After writing, sync the workspace and run the validators:
   `boxel lint`, `boxel parse`, `boxel evaluate`,
   `boxel instantiate`, `boxel test`. Fix anything that fails and
   re-run. The transpiled-output debugging guidance is in the
   operations skill.
5. When all validators pass, set the issue status to "done" and sync.
6. If you cannot make progress (e.g. the brief is ambiguous, or a
   validator failure is outside your scope to fix), set the issue
   status to "blocked", append a comment explaining why, and stop.

Report which issue you worked, what files you wrote, and the final
status.
```

### Prompt 3 — Continue or finish

```
Continue with the next unblocked issue using the same workflow.
If there are no unblocked issues left:

- If all Issues in the target realm have status "done", set the
  Project's projectStatus to "completed" and sync.
- If some issues remain in "blocked" or "backlog" with unmet blockers,
  report which ones and why.
```

The user runs Prompt 3 (or just types "continue") until Claude reports
the project is complete or that nothing is left to do.

## What the agent calls (and from where)

| Capability                | How the agent invokes it                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Realm creation            | `boxel run-command create-realm` (or `boxel realm create`)                          |
| Workspace pull / push     | `boxel pull` / `boxel push` (realm-sync skill)                                      |
| Federated search          | `boxel search --realm <url> --query '<json>'` (boxel-api skill)                     |
| Card-type schema          | `boxel run-command get-card-type-schema --realm <url> --input '{module,name}'`      |
| Lint                      | `boxel lint [path] --realm <url>` (whole-realm or single-file)                      |
| Parse / type-check        | `boxel parse [path] --realm <url>` (monorepo-only — glint + JSON validation)        |
| Evaluate module           | `boxel run-command evaluate-module --realm <url> --input '{path}'`                  |
| Instantiate card          | `boxel run-command instantiate-card --realm <url> --input '{path}'`                 |
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
     `boxel run-command get-card-type-schema ...`.
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

### Things explicitly NOT in Phase 1

- **Validation artifact cards** (`ParseResult`, `LintResult`,
  `EvalResult`, `InstantiateResult`, `TestRun`). The orchestrator
  persists these to the realm after every turn. Phase 1 skips them —
  validator output goes back to the agent inline; nothing is
  persisted. We can add a later skill that teaches the agent to write
  a `TestRun` card after a successful run if the catalog UI expects
  it.
- **Retry semantics on blocked issues.** The orchestrator's
  `--retry-blocked` flag is moot; the user (or Phase 2 automation)
  decides whether to re-prompt on a blocked issue.
- **Iteration limits.** The orchestrator caps inner iterations at 8 and
  outer cycles at 50. Phase 1 puts the user in charge of stopping;
  Phase 2 can re-introduce limits.
- **Validator-driven artifact persistence**: same as above.

## How Phase 2 builds on this

Phase 2 collapses the three prompts into a single user invocation —
likely a `/factory-run` slash command or a single prompt that delegates
through the same skills but loops internally until done. The skills,
CLI commands, and gap-fills from Phase 1 are unchanged; the only Phase
2 addition is a small "outer loop" skill that teaches the agent to
keep working issues until exhaustion.

## Validation plan for Phase 1

The runbook is validated end-to-end against the sticky-note brief at
`http://localhost:4201/software-factory/Wiki/sticky-note`. A
successful run produces, in the target realm, the same artifacts the
SDK orchestrator produces today (Project, IssueTracker, Knowledge
Articles, 2 Issues, `sticky-note.gts`, `sticky-note.test.gts`,
sample instances, Spec card). The Playwright suite in
`packages/software-factory/tests/` already encodes those expectations
and is the regression check.
