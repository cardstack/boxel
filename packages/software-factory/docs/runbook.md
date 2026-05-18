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

  **Dev `boxel` CLI setup.** The `boxel` CLI ships with the
  monorepo; until it's released as a standalone binary, install
  it as a globally-linked pnpm package:

  ```bash
  cd /path/to/boxel/packages/boxel-cli
  pnpm build
  pnpm link --global
  boxel --version
  ```

  If pnpm complains its global bin dir isn't on PATH, run
  `pnpm setup` once (idempotent), restart your shell, and retry.

  If `boxel --help` doesn't list `lint` / `parse` / `test`,
  your `dist/` is stale — `pnpm build` again.

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
- Claude Code is launched from `packages/software-factory/` so the
  `.claude/skills` symlink (→ `.agents/skills/`) is discovered.
  The agent creates its own scratch workspace inside `mktemp -d`
  during the run — you don't need to pre-create one.

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

Use a fresh temp directory (`mktemp -d`) as the workspace.

Follow docs/runbook.md end-to-end:

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
   Honor the bail-out limits in software-factory-operations'
   "Bailing out" section — stop iterating if you hit 8 total
   iterations on the Issue, or 3 consecutive identical failures
   from the same validator, or 5 distinct fix attempts without
   a single pass. When you bail out: set the Issue to
   `blocked` with a comment summarizing what failed and what
   you tried, push, then move on. Do NOT keep grinding past
   those limits.
5. Loop step 4 until no eligible Issues remain (either all
   `done`, or the remaining ones are `blocked` per step 4).
6. When the backlog is empty: if every Issue is `done`, set
   the Project's `projectStatus` to `completed` and push. If
   some Issues are `blocked`, leave `projectStatus` as
   `active` and report which ones are stuck and why.

Stop and report only if you hit a bail-out limit on every
remaining Issue. Otherwise, complete the project in this one
session.
```

> **Working through multiple prompts instead.** If you'd rather
> drive the run interactively — pausing between bootstrap and
> implementation, or between each Issue — paste the single prompt
> above and ask the agent to stop after each phase. The skills
> support both modes; the single-prompt form is the default
> because the recipe brief proved it works end-to-end without
> intervention.

## What the agent calls (and from where)

| Capability              | How the agent invokes it                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realm creation          | `boxel realm create <slug> "<display-name>"` (native subcommand; `<slug>` must match `^[a-z0-9-]+$`)                                                                                                        |
| Workspace pull / push   | `boxel realm pull <url> <dir>` / `boxel realm push <dir> <url>` (realm-sync skill)                                                                                                                          |
| Federated search        | `boxel search --realm <url> --query '<json>'` (boxel-api skill)                                                                                                                                             |
| Card-type schema        | `boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default --realm <url> --input '{"codeRef":{"module":"...","name":"..."}}'`                                                           |
| Lint                    | `boxel lint [path] --realm <url>` (whole-realm or single-file)                                                                                                                                              |
| Parse / type-check      | `boxel parse [path] --realm <url>` (monorepo-only — glint + JSON validation)                                                                                                                                |
| Evaluate module         | `boxel run-command @cardstack/boxel-host/commands/evaluate-module/default --realm <url> --input '{"moduleIdentifier":"<abs-url>","realmIdentifier":"<abs-url>"}'`                                           |
| Instantiate card        | `boxel run-command @cardstack/boxel-host/commands/instantiate-card/default --realm <url> --input '{"moduleIdentifier":"<abs-url>","cardName":"...","realmIdentifier":"<abs-url>","instanceData":"<json>"}'` |
| Run QUnit tests         | `boxel test --realm <url>` (monorepo-only — drives headless Chromium)                                                                                                                                       |
| Read transpiled output  | `boxel read-transpiled <path> --realm <url>` (for debugging eval/instantiate errors)                                                                                                                        |
| Write files             | native `Write` / `Edit`                                                                                                                                                                                     |
| Read / search workspace | native `Read` / `Glob` / `Grep`                                                                                                                                                                             |

There are no factory MCP tools. `signal_done` and
`request_clarification` are replaced by writing the issue's `status`
field directly (`done` / `blocked`) and appending to its `comments[]`
array.

## Follow-up work

A few rough edges remain — not blocking, but worth tracking:

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
- **Orchestrator retirement** — once this runbook has shipped and
  run in production for long enough, delete the SDK orchestrator
  code (`issue-loop.ts`, `factory-agent/`, etc.).

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
