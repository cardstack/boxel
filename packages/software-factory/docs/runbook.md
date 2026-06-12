# Interactive Factory Runbook

A user runs the software factory entirely from inside a logged-in
Claude Code session by pasting **one prompt** that drives the
agent through bootstrap, per-issue implementation, validation, and
project completion in a single end-to-end loop. There is no
orchestrator process; the agent does every step itself.

## Prerequisites

The user has done the following outside Claude Code:

- Installed `@cardstack/boxel-cli` globally and run `boxel profile add`
  so the active profile points at the target realm server.
  `boxel profile list` shows the active profile.

  ```bash
  pnpm i -g @cardstack/boxel-cli
  boxel --version
  ```

  `boxel --help` should list `lint`, `parse`, and `test` among the
  subcommands. If not, upgrade: `pnpm i -g @cardstack/boxel-cli@latest`.

- Installed Claude Code and run `/login` so the session is
  subscription-billed. `ANTHROPIC_API_KEY` is **not** set in the shell
  Claude Code launched from (it would override subscription auth — see
  the auth precedence in the Claude Code docs).
- A running realm server reachable at the URL they intend to use. For
  local work that is `mise run dev-all` in the boxel monorepo; for
  staging/prod they have credentials in their profile.
- `boxel test` runs entirely locally as of CS-11164 — no realm-server
  needed for tests. The CLI ships its own QUnit harness
  (`bundled-test-harness/`) and base-realm source (`bundled-realms/`)
  and starts an in-process transpiling module server that serves cards
  from the local workspace dir + bundled base realm. The agent loop is
  `write → boxel test`, no push step in between. One-time setup:
  `npx playwright install chromium` to fetch the headless browser
  binary; Playwright ships as a runtime dependency. Use
  `boxel test --realm <url>` to opt back into the older flow that
  tests cards already on a remote realm.
- `boxel parse` is self-contained from the published CLI as of
  CS-11165 — no monorepo needed. From inside the workspace dir,
  just run `boxel parse` (no flags) to type-check local files
  before pushing. That's the loop's default shape: catch type
  errors locally, fix, then push once clean. `--realm <url>` is
  only for the post-push case.
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
   the Project, IssueTracker, Knowledge Articles, and the
   implementation Issues, plus the bootstrap-seed Issue. The brief
   selects the flow: no `sourceCardUrl` → greenfield (one `feature`
   Issue per entry-point card); `sourceCardUrl` set → adjust (seed
   the source card, confirm a green baseline, then one `adjustment`
   Issue per delta — see the skill's "Adjust flow" section). Push
   the workspace.
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

## Adjusting an existing card

The factory can also **adjust an existing card** instead of building
new ones from scratch. The run contract is identical — the same two
inputs (brief URL + target realm URL) and the same prompt above. What
selects the adjust flow is the **brief**, not the prompt: a brief that
carries a `sourceCardUrl` attribute runs as an adjust; one without it
runs greenfield. (Full contract:
[adjust-existing-card-flow.md](./adjust-existing-card-flow.md).)

### Authoring an adjust brief

The brief is a `Wiki` card, exactly as for greenfield, with one extra
requirement: set the optional `sourceCardUrl` attribute to the
absolute URL of the card to adjust.

```jsonc
// the brief's JSON:API document
{
  "data": {
    "attributes": {
      "content": "…the adjustments, phrased as deltas to the source card…",
      "sourceCardUrl": "http://localhost:4201/catalog/mortgage-calculator",
    },
  },
}
```

- **`sourceCardUrl` is required for an adjust run.** Without it the
  factory runs greenfield and builds the brief's cards from scratch.
- **The source card must live on the same realm server** as the
  target realm, reachable with the active profile. A missing,
  malformed, or cross-server URL fails loudly at seed time (the
  ingest step can't fetch it) — it does not silently fall back to
  greenfield.
- **Write the brief content as deltas**, not as a full card spec:
  what changes about the source card (add field X, change behavior
  Y, restyle the fitted view), one coherent delta per adjustment you
  want. Bootstrap turns each delta into one `adjustment` Issue.

### What the run does differently

Adjust is a superset of greenfield: one extra sub-phase inside
bootstrap, then the standard Issue loop. During bootstrap the agent:

1. **Seeds the workspace (then the target realm on push)** with a working copy of the source card
   and its same-realm dependency graph —
   `boxel realm ingest-card "<source-card-url>" .` copies the card's
   module, the same-realm modules it imports (including type-only
   imports), its sample instances, and its card/app Catalog Spec.
   If the source card ships no co-located test (common for catalog
   cards), the agent writes **characterization tests** capturing its
   current behavior.
2. **Confirms a green baseline** — the standard validators must all
   pass on the seeded copy before any adjustment Issue is created. A
   zero-test run does not count as green.
3. **Writes a source-provenance Knowledge Article**
   (`Knowledge Articles/<slug>-source-provenance.json`): the
   `sourceCardUrl`, the files copied, and the baseline results.
4. **Creates `adjustment` Issues** — one per coherent delta the brief
   describes (instead of greenfield's one `feature` Issue per
   entry-point card). Each names the seeded file(s) to edit, the
   delta, and acceptance criteria that include "the baseline tests
   keep passing."

From there scheduling, the validator loop, the
`Validations/` audit-trail cards, the bail-out limits, and project
completion are identical to greenfield. The implementation agent
**edits the seeded artifacts in place** (module, tests, instances,
Spec) rather than creating parallel ones — see the "Adjustment
issues" section of `software-factory-operations`.

### Expected output (adjust run)

Same shape as the greenfield list below, with these differences:

- The card module, tests, sample instances, and `Spec/` card are the
  **seeded copies of the source card**, with the brief's deltas
  applied (plus characterization tests if the source had none).
- `Knowledge Articles/<slug>-source-provenance.json` — where the
  seed came from and the baseline validator results.
- `Issues/<slug>-<delta>.json` — one Issue per delta, with
  `issueType: "adjustment"`. The baseline validator results live in
  the provenance article, not in `Validations/` (those cards are
  per-Issue).

## What the agent calls (and from where)

| Capability              | How the agent invokes it                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realm creation          | `boxel realm create <slug> "<display-name>"` (native subcommand; `<slug>` must match `^[a-z0-9-]+$`)                                                                                                             |
| Workspace pull / push   | `boxel realm pull <url> <dir>` / `boxel realm push <dir> <url>` (realm-sync skill)                                                                                                                               |
| Federated search        | `boxel search --realm <url> --query '<json>'` (boxel-api skill)                                                                                                                                                  |
| Card-type schema        | `boxel run-command @cardstack/boxel-host/commands/get-card-type-schema/default --realm <url> --input '{"codeRef":{"module":"...","name":"..."}}'`                                                                |
| Lint                    | `boxel lint [path] --realm <url>` (whole-realm or single-file)                                                                                                                                                   |
| Parse / type-check      | `boxel parse [path]` from inside the workspace dir — defaults to type-checking **local files before push**. Add `--realm <url>` only when you want to check files already on the realm. glint + JSON validation. |
| Evaluate module         | `boxel run-command @cardstack/boxel-host/commands/evaluate-module/default --realm <url> --input '{"moduleIdentifier":"<abs-url>","realmIdentifier":"<abs-url>"}'`                                                |
| Instantiate card        | `boxel run-command @cardstack/boxel-host/commands/instantiate-card/default --realm <url> --input '{"moduleIdentifier":"<abs-url>","cardName":"...","realmIdentifier":"<abs-url>","instanceData":"<json>"}'`      |
| Run QUnit tests         | `boxel test` from inside the workspace dir (drives headless Chromium; CLI starts a local module server, no realm-server needed). `--realm <url>` opts into testing a remote realm instead.                       |
| Read transpiled output  | `boxel read-transpiled <path> --realm <url>` (for debugging eval/instantiate errors)                                                                                                                             |
| Write files             | native `Write` / `Edit`                                                                                                                                                                                          |
| Read / search workspace | native `Read` / `Glob` / `Grep`                                                                                                                                                                                  |

There are no factory MCP tools. `signal_done` and
`request_clarification` are replaced by writing the issue's `status`
field directly (`done` / `blocked`) and appending to its `comments[]`
array.

## Follow-up work

A few rough edges remain — not blocking, but worth tracking:

- **`/factory-run` slash command** — wrap the single prompt above
  as a slash command (or a `boxel factory run` CLI that spawns
  `claude` with the prompt baked in) so the user doesn't paste
  prose every time. One wrapper covers both flows, since the brief
  (not the prompt) selects greenfield vs adjust.
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
