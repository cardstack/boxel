---
name: ai-assistant-evals
description: Run and read the AI assistant evals in packages/ai-assistant-evals — a Playwright script that drives the real local stack (host, realm server, synapse, the real ai-bot and provider) and asks each LLM to build something, one fresh workspace and room per model. Two entry points, a bare prompt per model (`pnpm eval:models`) and EvaluationCard runs (`pnpm eval`, driven by the /run-ai-assistant-eval command, which also covers judging). Use when someone asks "which models work with the assistant", "does model X work", "test model X", "run the model evals", "run the eval", when a skill-text, prompt, or effort change needs a before/after on real models, or when a run failed and the room must be explained. Covers running it, the env knobs, reading summary.md, what each verdict means, the benchmarks and their targets, how an evaluation differs from a bare-prompt run, and how to follow a failed row into the room with inspect-ai-room.
---

# AI assistant evals

`packages/ai-assistant-evals` holds a Playwright spec that does, per model, what a person did
by hand all week: log in, create a workspace, open a room, pick the model, send
"create a hello world card and show it", wait until the bot is idle, check a
card rendered, and read the room's events for the numbers. One row per model.

It runs against the REAL local stack and the REAL provider. Every run spends
money (a few cents for a good model, up to a few dollars for a bad one) and
leaves a workspace and a room behind on the local synapse and realm server.
Do not run it to "see what happens", do not loop it, and do not rerun a model
whose result you have not read yet.

## Bare prompt or evaluation

`pnpm eval:models` is the fixed hello-world prompt, graded mechanically, nothing
written anywhere but `eval-results/`. `pnpm eval <evaluation-card-url>` is
the same browser flow fed by an EvaluationCard: the card's prompt and
follow-up prompts, its initial cards and files copied into the test workspace
first, a per-session results directory, and one EvaluationResultCard per
model plus one EvaluationReportCard written into the workspace the evaluation
lives in (the writer's AI Assistant Evaluations workspace, at the endpoint
`evals`, made by `pnpm eval:setup`). The
quality score on a result is a judge's, not the runner's: the
`/run-ai-assistant-eval` command in `.claude/commands` walks through running,
judging against the card's success criteria, and recording the score with
`pnpm eval:judge`. Everything below about watching a run, grades, verdicts and
benchmarks applies to both. For an evaluation with follow-up prompts the turn
and time targets are multiplied by the number of prompts.

## Prerequisites

- The dev stack is up: `mise run dev-all` with `OPENROUTER_API_KEY` set for the
  ai-bot. Check: `curl -sk -o /dev/null -w '%{http_code}' https://localhost:4200/`
  prints `200`.
- Every eval user holds at least 3000 credits. Running out mid-session turns the
  assistant's reply into "There was an error processing your request" and
  wastes the run, so top up first — the balance is the sum of that user's
  `credits_ledger` rows and a top-up is one `extra_credit` row. The
  `/run-ai-assistant-eval` command's preflight carries the query.
- The local matrix users `ai-assistant-eval-user-1` to `ai-assistant-eval-user-5` / `password` exist (see
  `EVAL_USERS` below). `pnpm eval:users` registers whoever is missing, and
  `pnpm eval` refuses to start without them rather than failing on the first
  browser action of a paid run. For evaluations, `pnpm eval:setup` has created the
  AI Assistant Evaluations workspace of the writer user (`user` locally), at
  the endpoint `evals`, and pushed the cards.
- Every model you name has a ModelConfiguration card in the SystemCard the host
  uses (`packages/catalog/contents/SystemCard/default.json`), or the picker
  will not offer it.
- Playwright's Chromium is installed (`pnpm exec playwright install chromium`
  in `packages/ai-assistant-evals` if a run complains).

Nothing needs a restart for skill, prompt-file, or catalog-card changes: the
realm server reads those from disk. A NEW room is required for a skill change
to apply, and the runner always creates one. Host or ai-bot code changes do
need the stack restarted.

## Run

From `packages/ai-assistant-evals`:

```sh
EVAL_MODELS="Claude Sonnet 4.6,Claude Opus 4.8" pnpm eval:models          # headless
EVAL_MODELS="Claude Sonnet 4.6" pnpm eval:models:headed                   # watch it
EVAL_MODELS="Claude Sonnet 4.6,Claude Opus 4.8" pnpm eval:models:tabs     # watch several, one tab each
```

An evaluation run takes the same choice as a flag: `pnpm eval <url> [models]`
shows one window per model, still side by side, unless `--headless` (show
nothing) or `--headed` (watch, one model at a time) says otherwise. Showing is
the default because a run takes minutes and what the assistant does on screen
is most of what there is to see, and `--tabs` costs no wall-clock.

Knobs (env vars):

| var                                     | default                                            | meaning                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EVAL_MODELS`                           | `Claude Sonnet 4.6`                                | comma-separated model names **as the picker shows them**; substring, case-insensitive, must match exactly one option (the picker keys options by ModelConfiguration card id, not model id — the model id actually used is read back from the room)                                                     |
| `EVAL_PROMPT`                           | `create a hello world card and show it`            | the prompt                                                                                                                                                                                                                                                                                             |
| `EVAL_MAX_MINUTES`                      | 15                                                 | safety net only; a run still going after that is stopped. Pace is graded, never a reason to stop                                                                                                                                                                                                       |
| `EVAL_USERS` / `EVAL_PASSWORD`          | `ai-assistant-eval-user-1` … `-5` / `password`     | one local matrix user per model, comma-separated, same password. Register once: `MATRIX_USERNAME=ai-assistant-eval-user-1 MATRIX_PASSWORD=password node ./scripts/register-test-user.ts` in `packages/matrix`, per user. Two models on one account race over which room the panel opens on (see below) |
| `EVAL_HOST_URL` / `EVAL_MATRIX_URL`     | `https://localhost:4200` / `http://localhost:8008` | stack endpoints                                                                                                                                                                                                                                                                                        |
| `EVAL_BOT_USER`                         | `@aibot:localhost`                                 | the ai-bot's matrix id                                                                                                                                                                                                                                                                                 |
| `EVAL_WORKERS` / `EVAL_STAGGER_SECONDS` | 5 / 40                                             | parallel workers, and the gap between their starts                                                                                                                                                                                                                                                     |

Models run in parallel, `EVAL_WORKERS` at a time (default 5), starting
`EVAL_STAGGER_SECONDS` apart (default 40) so the dev server's first page
loads do not pile up. A sweep takes about as long as its slowest model.
`eval:models:headed` runs one worker; `eval:models:tabs` opens one incognito window per
model in one browser.

Every model runs as a different matrix user, because which room the assistant
panel opens on is that account's own state: a worker lands on its user's
current room and starts a new session from it. Two browsers on one account
race over that, and a prompt can land in the other model's room. The ai-bot
itself does not serialize them — its per-user cost lock covers the credit gate
and the debit, not the generation — so the rooms run at once and interleave.
A run that would put more models than users on screen at once stops before it
opens a browser; one worker with no tabs runs the models one at a time, so it
may share accounts.

## Watch the run

Do not start a run and look away. While it runs, watch the assistant panel (or
the runner's console) for anything irregular: a tool pill that goes red or
"invalid", an error alert, a block written with `<<<<<<< SEARCH` markers, the
model asking the user for permission or for file names, the same file read
twice, a second `switch-submode` in a row, a placeholder tool call, a pill
spinning for more than two minutes, a tab that jumps to another realm. Any of
these means the run has already failed and every further turn is paid for
nothing.

When one appears:

1. **Stop the generation, but only when it has clearly gone sideways.** The
   runner does this itself when four separate turns carry a failed or invalid
   pill or an error alert (a normal repair takes two or three rounds, each of
   which can fail once more before it lands), git-style markers, the
   same tool call repeated three times, a pill stuck past the host's two-minute
   tool timeout, a turn that streams nothing for three minutes, and the
   15-minute safety clock (verdict notes start with "stopped early"). It never stops a run for being
   slow, long, or expensive: those are graded afterwards, and cutting them
   hides what the model would have done next. For anything the runner does
   not catch, click Stop in the panel only when you can name what went wrong.
2. **Pull the room** with `inspect-ai-room` and read it turn by turn: the
   reasoning, the tool arguments, the results, the patch markers.
3. **Say what went wrong and where the fix belongs**, in this order of
   likelihood: skill text the model followed too literally or did not read;
   the prompt the ai-bot builds; the host (a stuck pill, a tool that moved the
   editor, a rejected argument); the model itself. Name the file or component
   for each suggested fix. A model verdict without a suggested fix is not a
   finished report.

## Read the result

`eval-results/` (git-ignored) holds `summary.md`, one `<model>.json` and one
`<model>.png` per model, and a Playwright trace for each failed run. The table
is also printed at the end of the run.

Columns: result grade, model id used, effort the room carried, verdict, turns,
tool calls by name with counts, SEARCH/REPLACE blocks (with a `+N git-style`
note when the model used the wrong markers), cost, wall time, whether a card
rendered and where (`stack` or `preview`), notes with the reasons, the missed
benchmarks, and the room id.

The grade is the one-word answer per model:

- ✅ **GOOD** — it did the job nicely. The card rendered inside every
  benchmark below: at most 8 turns, one mode switch, two minutes, no failed
  step, no cache miss after the skill load.
- 🟡 **ROUGH** — it did the job, but not nicely. The card rendered, and the
  way there missed a benchmark: too many turns, too slow, a failed step it had
  to repair, or a cache miss. A usable model with rough edges; the notes say
  where. Not an alarm. Cost does not grade: it is shown in its own column and
  judged against the model's price class, see below.
- ❌ **FAIL** — it did not do the job. No card on screen, or the run had to be
  stopped (irregularity, stuck pill, safety clock, runner error).

When you report a run to the user, render the summary as a markdown table
(not inside a code fence) and lead with the grade. A finished report looks like
this, from a real run on 2026-09-07:

| Result  | Model                       | Effort | Verdict | Turns | Tool calls                                        | Blocks | Cost   | Cache | Time | Card               |
| ------- | --------------------------- | ------ | ------- | ----- | ------------------------------------------------- | ------ | ------ | ----- | ---- | ------------------ |
| ✅ GOOD | anthropic/claude-sonnet-4.6 | –      | pass    | 5     | readRealmFile ×1, switch-submode ×1, show-card ×1 | 2      | $0.090 | 95%   | 63 s | yes, preview panel |

Room `!ELKEdZReSeJdwgUnRV:localhost`. Every benchmark inside its target, turns
and mode switches both exactly at the limit.

One line after the table says what to look at: which benchmarks were at the
limit, the room id, and, for anything but GOOD, what went wrong and where the
fix belongs (see "Watch the run"). Do not paste the runner's console output or
the raw JSON.

After every run, two checks on the money, whatever the grade:

1. **Was the cost reasonable for this model?** Compare the Cost column with
   the model's price class and with the turn count. A cheap model at $0.20 or
   an expensive one at $0.50 for a hello-world means turns were wasted; say
   which ones, from the tool-calls column and the room.
2. **Did prompt caching work?** The Cache column gives the headline; confirm it
   in the room with the `inspect-ai-room` skill:

   ```sh
   node .claude/skills/inspect-ai-room/scripts/inspect-room.mjs usage '<roomId>'
   ```

   Expect `cached` near zero on the turn right after the first skill read (the
   tools list changed, so the prefix did; this is the ai-bot's structural miss
   and is not counted) and near the whole prompt on every turn after that. A
   reset to a low number later means the history was rewritten or the provider
   changed; a gap of several minutes between turns means the cache expired.
   Report a counted miss with the turn it happened on and its cost.

Verdicts:

- `pass` — a card from the new workspace rendered with no error boundary, and at
  least one block was written.
- `model-failure` — the model did not get there: no blocks, git-style markers,
  a failed patch, or no card. Reasons are listed.
- `host-failure` — a tool pill stayed in "applying" past the host's own
  two-minute tool timeout, or a tool call never got a result. The model may be
  fine; the tab froze. Keep the room id, this is a repro for a host bug.
- `bot-failure` — the bot showed "Generating results" with no new text for
  three minutes: the request between the ai-bot and the provider never came
  back. The ai-bot has no timeout of its own for this. Not the model's doing;
  check the ai-bot's terminal for the request error.
- `runner-failure` — the script itself broke (a selector, a timeout on the UI).
  The step name is in the notes. Fix the runner, not the model.

Always follow a non-pass row into the room:

```sh
node .claude/skills/inspect-ai-room/scripts/inspect-room.mjs timeline '<roomId>'
```

and read the bot's reasoning and tool arguments turn by turn before deciding
whether the model, the skill text, or the host is at fault. The `inspect-ai-room`
skill covers this.

## Benchmarks

The prompt is deliberately small. A model that cannot do this cannot build
anything with the assistant. What we grade, and the targets, calibrated on
Claude Sonnet 4.6 without thinking, the model the workflow was tuned for:

| metric                       | how to read it                                                                                                                                                                                                                                                                                                                           | target                                                                                                                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verdict                      | card rendered, no error                                                                                                                                                                                                                                                                                                                  | `pass`                                                                                                                                                                                                                                                      |
| turns                        | bot messages that carried usage                                                                                                                                                                                                                                                                                                          | up to 8 (a clean run is 3 to 5: one or two reads, one write, one show; a repair round adds two or three)                                                                                                                                                    |
| turns before the first block | count in the room timeline                                                                                                                                                                                                                                                                                                               | 1 to 2                                                                                                                                                                                                                                                      |
| `switch-submode` calls       | tool-calls column                                                                                                                                                                                                                                                                                                                        | 0 or 1; more means the model treats a mode switch as a step of writing                                                                                                                                                                                      |
| placeholder / confirm calls  | tool calls whose arguments do nothing (show-card on a `.gts`, switch to the current mode, empty patch-fields)                                                                                                                                                                                                                            | 0                                                                                                                                                                                                                                                           |
| patch markers                | `Blocks` column                                                                                                                                                                                                                                                                                                                          | box markers only; any `git-style` count is a hard fail — the host applies nothing and tells the model nothing                                                                                                                                               |
| files written in one reply   | `filesWritten` in the JSON                                                                                                                                                                                                                                                                                                               | definition and instance in the same reply                                                                                                                                                                                                                   |
| cost                         | Cost column, not part of the grade                                                                                                                                                                                                                                                                                                       | judge it against the model's price class: Sonnet 4.6 lands at $0.05 to $0.10, so $0.20 for it already means extra turns; an Opus-class model costs two to three times that for the same work. A run over $1 is a fragmentation problem, not a price problem |
| prompt cache                 | Cache column: share of input tokens served from the cache, counted only after the initial skill load. Turn one has one tool; the first skill read adds the host tools, and tools lead the cached prefix, so the turn right after the read is always billed cold. That structural miss is excluded; the window opens on the turn after it | 90% or more, 0 misses inside the window. A miss there means history was rewritten, the cache expired between turns, or the provider changed                                                                                                                 |
| wall time                    | Time column                                                                                                                                                                                                                                                                                                                              | under 2 minutes                                                                                                                                                                                                                                             |

Every run costs real money, so run each model once. One run answers the
question it is for: can this model do the smallest build. A pass is a pass. A
failure gets read in the room before anything is concluded, because the set of
skill files a model reads varies per run and a single failure may be a skipped
read rather than the model. Rerun only when that reading says the failure was
incidental, and only that model.

Known model profiles, from the 2026-09-07 sweep of all 27 catalog models
(one run each, the failures rerun once or twice, best run kept; the full
report is the PDF from that day):

| Best grade | Models                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ GOOD    | Claude Sonnet 4.6, Claude Opus 4.7, Claude Opus 4.8, Claude Fable 5, Gemini 3.5 Flash, Kimi K2.7 Code                                                                               |
| 🟡 ROUGH   | Claude Sonnet 5 (medium), DeepSeek V4 Pro, GLM 5.2, GPT-5.4, GPT-5.5, GPT-5.6 Sol (medium), GPT-5.6 Terra, Gemini 3.1 Flash Lite, Qwen3.7 Max                                       |
| ❌ FAIL    | Claude Haiku 4.5, GPT-5.4 Mini, GPT-5.4 Nano, Gemini 3.1 Pro, Grok 4.5, Grok 4.3, DeepSeek V4 Flash, Qwen3.6 Flash, GLM 4.7 Flash, MiniMax M3, Mistral Medium 3.5, Llama 4 Maverick |

How the failures group, so a new run can be placed quickly:

- **Ask instead of act**: GPT-5.4 (first run), GPT-5.4 Mini, GPT-5.4 Nano,
  Mistral Medium 3.5. A clarifying or confirmation question in Act mode.
- **Announce the write, then stop**: Grok 4.5, Grok 4.3, Qwen3.7 Max (first
  run), GLM 4.7 Flash, Haiku 4.5 (one run). "Creating the card now" and the
  turn ends with no block.
- **Dropped closing marker**: DeepSeek V4 Flash, Grok 4.3, Haiku 4.5, Fable 5
  (one run). SEARCH, divider, content, fence, no `╚═══ REPLACE ═══╝`; the host
  applies nothing.
- **Instance JSON that is not a card document**: Haiku 4.5, MiniMax M3, Mistral
  Medium 3.5, Qwen3.6 Flash, Llama 4 Maverick. No `data` wrapper, `type` set to
  the card's name instead of `card`, or no `meta.adoptsFrom`. The correctness
  check now names this on the turn the file is written.
- **Coin flips**: Grok 4.5, GPT-5.5, Gemini 3.1 Pro, Gemini 3.5 Flash gave
  different grades on different runs. One run says little about them.
- Claude Sonnet 5 at low or medium effort fragments the work (placeholder
  calls, a mode switch before writing, the write deferred behind more reads)
  and lands at 8 to 9 turns; at default effort it overthinks for minutes.
- GPT-5.6 Sol without an effort setting reasoned for 10 minutes to the 65k
  output cap, twice; at medium it turns in seconds.

## Known platform causes of a stalled or lost turn

Check these before blaming the model. Status as of 2026-09-08.

- **Room events dropped under concurrency.** The bot's sliding sync window was
  one room wide; two rooms active in the same instant lost one event. Fixed by
  widening the window.
- **One user's rooms take turns.** Per-user cost lock around the whole
  generation. Fixed by locking only the credit check and the debit.
- **Several `readRealmFile` calls in one turn stall the continuation.** Results
  now publish one after another.
- **Patch result indexes do not line up** when a message has example code
  fences before its patches; the bot now counts results instead of matching
  positions.
- **A patch cut across continuation events** is never applied; the cut now
  moves back to the opening fence.
- **`set-active-llm` accepted any mode** and dropped the room into Ask; now
  rejects anything but `act` or `ask`.
- **Correctness check passed JSON that is not a card document**; now reports
  what is missing.
- **Open**: no output cap and no stall abort in the bot (a reasoning turn can
  run to the provider's 65k cap with nothing streamed); prerender timeout
  under five concurrent workspaces reported as a code error; a fence glued to
  prose is not a code block for the host but a patch for the bot; the dropped
  closing marker could be accepted by the host as the end of a REPLACE block.

## What the runner cannot tell you

- Whether the card looks right. Look at the capture.
- Why the host froze, when it did. That needs the tab's console; the runner
  keeps the room and the trace.
- Whether the card still works after the run. The snapshot holds the code and
  the card documents; nobody interacts with the card.
- Anything beyond the prompts the evaluation carries. An evaluation sends its
  `followUpPrompts` one at a time once the bot is idle, and the turn and time
  budgets multiply by the prompt count; a bare `pnpm eval:models` run sends the
  one prompt in `EVAL_PROMPT`.

## Changing the runner

`assistant-eval.spec.ts` is the flow, `run-result.ts` the result shape and the
grade, `room-analysis.ts` the numbers, `matrix-api.ts` the two matrix calls,
`realm-api.ts` the realm session and reads and writes, `eval-card.ts` the
evaluation reader and workspace pre-population, `run-eval.ts` and
`judge-result.ts` the evaluation entry points. Selectors are the host's
`data-test-*` attributes, used inline in each helper of the spec. If the host
changes a selector the run ends as `runner-failure` with the step name.
`pnpm lint` type-checks the package. The three cards are in
`eval-realm/evaluation.gts`; the evaluations themselves are JSON under
`eval-realm/Evaluation/`. An evaluation that wants a card or file already in
the test workspace names it in `initialCards` / `initialFiles` and keeps it
under `eval-realm/`; the runner copies those in before the prompt.
`pnpm eval:setup` pushes them into the writer's AI Assistant Evaluations
workspace.
