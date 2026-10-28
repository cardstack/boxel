# AI assistant evals

Drives the real host, the real ai-bot, and the real provider from Playwright,
one fresh workspace and room per model. Two entry points share the flow:

- `pnpm eval:models` sends one prompt (a hello-world build by default) to each model
  and prints one graded row per model. Use it to decide which models the
  SystemCard should list.
- `pnpm eval <evaluation-card-url> [models]` runs an EvaluationCard: its
  prompts, its success criteria, and the cards and files the workspace starts
  with come from the card, and the outcome is written back as cards next to it.
  The `/run-ai-assistant-eval` command in `.claude/commands` drives this and the
  judging that follows.

## Evaluations

An evaluation is three cards, defined in `eval-realm/evaluation.gts`. They
live in a workspace of the person running them, not in a shared realm:
`pnpm eval:setup` creates a workspace at the endpoint `evals`, shown as
"AI Assistant Evaluations", for the writer user (the same create-realm call
the app's "new workspace" dialog makes) and pushes everything under
`eval-realm/` into it. Locally the writer is `user`, so the workspace is
`https://localhost:4201/user/evals/` and shows up in that account's workspace
chooser under that name. Setup can run again at any time; it writes every file
over, and it reapplies the display name, so `--name` renames a workspace that
already exists. `--endpoint` only takes effect on a new one, since the
endpoint is the URL.

- **Evaluation** (`Evaluation/*.json`): `assistantPrompt`, optional
  `followUpPrompts` sent one at a time once the bot is idle, `successCriteria`
  a judge scores against, `initialCards` and `initialFiles` copied into the
  test workspace before the prompt (same path relative to the realm root, so
  relative `adoptsFrom` references keep working; the cards are opened in the
  stack so they are in the message context), `skillFeatures` switched on in
  each room before the first prompt (`EVAL_SKILL_FEATURES` adds more, and a
  name with a leading `-` leaves one out), `expectedChangedCards` naming the
  seeded cards the prompt asks to change (when set, the runner's rendered-card
  check needs every one of these changed from its seed, and one of them shown
  in the stack or the preview panel, not only embedded in another card),
  `promptCards` naming, by position, the open card each prompt is about (the
  runner brings it to the top of the stack before that prompt, since only a
  stack's top card goes into the message context),
  `secondsPerPrompt` replacing the default 200 s time target for each prompt,
  and a query-backed `sessionReports` list.
- **EvaluationResult**: one per model per session. The runner fills the
  mechanical fields (verdict, turns, cost, caching rate, start and end, tool
  calls, notes, the screenshot, the skills the room had). A judge fills
  `qualityScore` (0 to 10) and `analysis` with `pnpm eval:judge`. The card
  computes `effectivenessScore` (half quality, the rest turns, cost, cache and
  time) and `effectivenessTier` (`failed` under 40, `rough` under 70, `good`
  under 85, `great` from 85).
- **EvaluationReport**: one per session, with a query-backed `results` table
  and the total cost.

Fifteen evaluations ship. `hello-world` is the smallest build there is, one
definition and one instance shown on screen — the one to start from, and the
one to reach for when checking that a change did not break the basics.
`linkedin-profile-computed-edit-restyle` is the step up: one definition with a
computed field and two instances, then a follow-up that adds a field, edits the
definition and both instances in place, and restyles the card.
`cookbook-computeds-links-instances-restyle` is the substantial one: two definitions linked by a
`linksToMany`, a computed field on each, three instances, and then a follow-up
prompt in the same room that changes only the look, so it also grades whether
the assistant edits its own work in place instead of writing it again.
`reading-list-save-then-answer` grades the reply rather than the build: a small
card with three instances, then a list and a closing line the user asks for once
everything is saved. It catches a final reply that shrinks to a one-sentence
acknowledgement after the write passes its correctness check.
`reuse-service-desk-build` and `reuse-listing-ownership` grade catalog reuse:
how much of a brief the assistant answers from catalog parts, and whether it
references a catalog definition or installs its own copy. The three
`search-route-*` evaluations check that a search runs through a
`run-realm-code` script. The three `mutation-*` evaluations change card
data, never a definition, one task per prompt in a single session, each task
on its own card. `mutation-field-values` fills a card with sample data,
redacts personal information and sets an enum, and moves dates to today while
keeping them relative. `mutation-lists` adds entries to `containsMany` fields,
adds an item to a list of mixed item types, and edits a list whose items link
to cards. `mutation-links` moves linked cards from one `linksToMany` to
another, and changes a linked card rather than the open one. Their seeds live
under `eval-realm/card-mutation/`, most with a decoy card beside the one to
change, and their criteria are judged by comparing each card's seed with what
the workspace snapshot holds afterwards. Three tasks cover a known gap, where
the skills say nothing or a tool silently does the wrong thing (the phone in
the sample data, the mixed-type list, and the list whose items link to
cards); their notes say so, and they are expected to fail there until it is
fixed.
The two `bulk-*` evaluations change many cards from one prompt, one task per
prompt in a single session. `bulk-vendors-invoices` sets all 45 vendors to
NET 30 (6 already are) past customer cards with the same field, lists the
unpaid invoices more than 60 days overdue as of a date the prompt names, and
makes every vendor adopt from a subclass, which takes more files than one
`run-realm-code` call can write. `bulk-records` raises the variant prices of 60 coffee products, more
than a search returns when it names no page size, and reassigns a leaving
agent's open tickets, which is a link change. Their seeds live under
`eval-realm/bulk-operations/`. Their `expectedChangedCards` list a sample of
each task's targets, and the judge checks the rest from the workspace
snapshot. Keep a bulk task under about 100 changed cards: each card a run
changes adds a correctness check to one Matrix event, and about 100 take that
event past Matrix's 64 KB limit, which breaks the room.

Add one by adding a JSON file under `eval-realm/Evaluation/` and running setup
again. An evaluation that wants a card or a file already in the test workspace
puts it in `initialCards` / `initialFiles`; the runner copies those in before
the prompt.

A skill change that targets a core use case adds an evaluation that shows the
problem it fixes; the `skill-change-eval` skill in `.claude/skills` covers how.

```sh
pnpm eval:setup                                    # once, and after editing eval-realm/
pnpm eval https://localhost:4201/user/evals/Evaluation/hello-world
pnpm eval linkedin-profile-computed-edit-restyle "GPT-5.6 Luna"   # the file name under eval-realm/Evaluation/ works too
pnpm eval https://localhost:4201/user/evals/Evaluation/hello-world "Claude Sonnet 4.6,GPT-5.5" --headless
pnpm eval:judge https://localhost:4201/user/evals/EvaluationResultCard/<id> --score 8 --analysis-file notes.md
```

`pnpm eval` signs in as the writer, reads the evaluation and the bytes of its
initial cards and files into a bundle (`eval-results/<session-id>/evaluation.json`),
creates a session id, writes the report card, runs the spec with
`EVAL_BUNDLE` and `EVAL_SESSION_ID` set and the per-session results directory,
then writes one result card per model, uploading the screenshot into the
workspace. `--no-cards` skips every write.

How the browsers show up is one flag. The default is to show them: a single
headed browser with a window per model, all still running side by side, so
watching costs no wall-clock (`--tabs` names that explicitly). `--headless`
shows nothing. `--headed` gives a plain window but runs one model at a time,
which makes a sweep as long as the sum of its models. The eval users that drive the
browsers never touch the evaluations workspace: they get the bundle. The
writer is `EVAL_WRITER_USER` / `EVAL_WRITER_PASSWORD` (default `user` /
`password`); `EVAL_REALM_SERVER_URL` (default `https://localhost:4201`) is
where setup creates the workspace.

## Run

Start the dev stack first (`mise run dev-all` with `OPENROUTER_API_KEY` set for
the ai-bot). Then, from `packages/ai-assistant-evals`:

```sh
EVAL_MODELS="Claude Sonnet 4.6,Claude Opus 4.8" pnpm eval:models
```

`pnpm eval:models:headed` shows the browser, one model at a time. `pnpm eval:models:tabs` opens
every model as a tab of one headed browser and runs them at once.

- `EVAL_MODELS` — comma-separated model names as the picker shows them
  (substring match, case-insensitive, must match exactly one option). The
  picker keys options by ModelConfiguration card id, not model id, so names
  are the stable handle; the model id actually used is read back from the room
  and recorded. Default: `Claude Sonnet 4.6`.
- `EVAL_PROMPT` — the prompt to send. Default: `create a hello world card and show it`.
  Ignored when `EVAL_BUNDLE` is set (`pnpm eval` sets it).
- `EVAL_RESULTS_DIR` — where the JSON, screenshots and `summary.md` land.
  Default `eval-results/`; `pnpm eval` uses `eval-results/<session-id>/`.
- `EVAL_USERS` / `EVAL_PASSWORD` — comma-separated local matrix users, one per
  model, all with the same password. Default `ai-assistant-eval-user-1` … `-5` / `password`.
  Register them once from `packages/matrix`, per user, with
  `MATRIX_USERNAME=ai-assistant-eval-user-1 MATRIX_PASSWORD=password node
./scripts/register-test-user.ts` — the `pnpm register-test-user` script
  hardcodes its own username and ignores the env. Each user must be
  different: which room the assistant panel opens on is that account's own
  state, so two browsers signed in as one account race over it and a prompt
  can land in the other model's room. A run that puts more models than users
  on screen at once stops before it opens a browser.
- `EVAL_HOST_URL`, `EVAL_MATRIX_URL` — default `https://localhost:4200`,
  `http://localhost:8008`.
- `EVAL_MAX_MINUTES` (default 15) is a safety net only: a run still going after
  that is stopped. Nothing else about pace stops a run; slow runs are graded.
- `EVAL_BOT_USER` — the ai-bot's matrix id. Default `@aibot:localhost`.

Results land in `eval-results/` (git-ignored): `summary.md` (the table), one
JSON and one screenshot per model, and Playwright traces for failed runs.
A run also prints the table at the end.

## What a run does

1. Logs in, creates a new workspace with a unique name, enters it.
2. Opens the assistant, creates a room, selects the model, keeps mode `act`.
3. Sends the prompt (in an evaluation: copies the initial cards and files
   first, and sends each follow-up prompt once the bot is idle) and waits
   until the bot is idle: no message streaming, no
   tool pill applying or waiting for approval, no pending Accept. The run is cut
   short only when it has clearly gone wrong (three turns in a row with a
   failed or invalid tool call or an error alert, or eight in all, the same
   call repeated three times, a pill stuck past the host's tool timeout) or
   after the safety wall clock.
4. Looks for a rendered card in the stack that is not the workspace index, not
   a card the run seeded, and has no error state; for an evaluation with
   `expectedChangedCards`, checks each of those against its seed and waits
   for the index to catch up first. Screenshots the page.
5. Reads the room's Matrix events: turns, tokens, cost, tool calls and their
   outcomes, run-realm-code writes and other writing tool calls, files written.
6. Classifies: `pass` (card rendered, and at least one applied run-realm-code
   or other writing tool call), `model` failure (never wrote, wrong
   tool, gave up), or `host` failure (a pill stuck applying, a
   tool with no result, the tab left the workspace). Keeps the room id so the
   room can be inspected afterwards.

Models run in parallel, `EVAL_WORKERS` at a time (default 5), each as its own
matrix user in its own browser context, workspace, and room; the ai-bot works
rooms of different users concurrently. Starts are staggered
(`EVAL_STAGGER_SECONDS`, default 40) to keep the dev server's first page loads
apart, and a run fails itself if a second prompt shows up in its room.
`eval:models:headed` runs one worker so there is one window to watch; `eval:models:tabs`
opens one incognito window per model in a single browser.

The `ai-assistant-evals` skill, in the repo root's
`.claude/skills/ai-assistant-evals/SKILL.md`, explains the
benchmarks and how to read a run. `assistant-eval.spec.ts` is the flow,
`run-result.ts` the result shape and the grade, `room-analysis.ts` the numbers
from the room, `matrix-api.ts` and `realm-api.ts` the two APIs, `eval-card.ts`
the evaluation reader and workspace pre-population, `eval-setup.ts`,
`run-eval.ts` and `judge-result.ts` the evaluation entry points, and
`eval-realm/` the cards themselves.
