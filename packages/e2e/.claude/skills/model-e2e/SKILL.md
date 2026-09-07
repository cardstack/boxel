---
name: model-e2e
description: Run and read the end-to-end model smoke runner in packages/e2e — a Playwright script that drives the real local stack (host, realm server, synapse, the real ai-bot and provider) and asks each LLM to build a hello-world card and show it, one fresh workspace and room per model. Use when someone asks "which models work with the assistant", "does model X work", "test model X", "run the smoke", when a skill-text, prompt, or effort change needs a before/after on real models, or when a smoke run failed and the room must be explained. Covers running it, the env knobs, reading summary.md, what each verdict means, the benchmarks and their targets, and how to follow a failed row into the room with inspect-ai-room.
---

# Model e2e runner

`packages/e2e` holds a Playwright spec that does, per model, what a person did
by hand all week: log in, create a workspace, open a room, pick the model, send
"create a hello world card and show it", wait until the bot is idle, check a
card rendered, and read the room's events for the numbers. One row per model.

It runs against the REAL local stack and the REAL provider. Every run spends
money (a few cents for a good model, up to a few dollars for a bad one) and
leaves a workspace and a room behind on the local synapse and realm server.
Do not run it to "see what happens", do not loop it, and do not rerun a model
whose result you have not read yet.

## Prerequisites

- The dev stack is up: `mise run dev-all` with `OPENROUTER_API_KEY` set for the
  ai-bot. Check: `curl -sk -o /dev/null -w '%{http_code}' https://localhost:4200/`
  prints `200`.
- The local matrix user `user` / `password` exists (dev-all registers it).
- Every model you name has a ModelConfiguration card in the SystemCard the host
  uses (`packages/catalog/contents/SystemCard/default.json`), or the picker
  will not offer it.
- Playwright's Chromium is installed (`pnpm exec playwright install chromium`
  in `packages/e2e` if a run complains).

Nothing needs a restart for skill, prompt-file, or catalog-card changes: the
realm server reads those from disk. A NEW room is required for a skill change
to apply, and the runner always creates one. Host or ai-bot code changes do
need the stack restarted.

## Run

From `packages/e2e`:

```sh
SMOKE_MODELS="Claude Sonnet 4.6,Claude Opus 4.8" pnpm smoke          # headless
SMOKE_MODELS="Claude Sonnet 4.6" pnpm smoke:headed                   # watch it
SMOKE_MODELS="Claude Sonnet 4.6,Claude Opus 4.8" pnpm smoke:tabs     # watch several, one tab each
```

Knobs (env vars):

| var                                       | default                                            | meaning                                                                                                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMOKE_MODELS`                            | `Claude Sonnet 4.6`                                | comma-separated model names **as the picker shows them**; substring, case-insensitive, must match exactly one option (the picker keys options by ModelConfiguration card id, not model id — the model id actually used is read back from the room) |
| `SMOKE_PROMPT`                            | `create a hello world card and show it`            | the prompt                                                                                                                                                                                                                                         |
| `SMOKE_MAX_MINUTES`                       | 15                                                 | safety net only; a run still going after that is stopped. Pace is graded, never a reason to stop                                                                                                                                                   |
| `SMOKE_USERS` / `SMOKE_PASSWORD`          | `smoke1,…,smoke5` / `password`                     | one local matrix user per model, comma-separated, same password. Register once: `MATRIX_USERNAME=smoke1 MATRIX_PASSWORD=password pnpm register-test-user` in `packages/matrix`, per user. Two models on the same user take turns (see below)       |
| `SMOKE_HOST_URL` / `SMOKE_MATRIX_URL`     | `https://localhost:4200` / `http://localhost:8008` | stack endpoints                                                                                                                                                                                                                                    |
| `SMOKE_BOT_USER`                          | `@aibot:localhost`                                 | the ai-bot's matrix id                                                                                                                                                                                                                             |
| `SMOKE_WORKERS` / `SMOKE_STAGGER_SECONDS` | 5 / 40                                             | parallel workers, and the gap between their starts                                                                                                                                                                                                 |

Models run in parallel, `SMOKE_WORKERS` at a time (default 5), starting
`SMOKE_STAGGER_SECONDS` apart (default 40) so the dev server's first page
loads do not pile up. A sweep takes about as long as its slowest model.
`smoke:headed` runs one worker; `smoke:tabs` opens one incognito window per
model in one browser.

Every model must run as a different matrix user. The ai-bot holds a per-user
cost lock around the whole generation, across all rooms of that user, so a
second prompt from the same user waits at "Thinking..." until the first
model's turn ends. A sweep on one user is not a sweep: the slowest model sets
the pace for all of them, and the runner reads the waiting rooms as stalled
bot turns. The runner warns when there are more models than users.

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

`smoke-results/` (git-ignored) holds `summary.md`, one `<model>.json` and one
`<model>.png` per model, and a Playwright trace for each failed run. The table
is also printed at the end of the run.

Columns: result grade, model id used, effort the room carried, verdict, turns,
tool calls by name with counts, SEARCH/REPLACE blocks (with a `+N git-style`
note when the model used the wrong markers), cost, wall time, whether a card
rendered and where (`stack` or `preview`), notes with the reasons, the missed
benchmarks, and the room id.

The grade is the one-word answer per model:

- ✅ **GOOD** — passed and inside every benchmark below.
- 🟡 **ROUGH** — it worked, but not cleanly: the card rendered and a
  benchmark was missed on the way (more than 5 turns, more than one mode
  switch, over 120 s, a failed patch or tool call, or a turn that missed the
  prompt cache). The model is usable; the notes say where it wastes effort.
  Not an alarm. Cost does not grade: it is shown in its own column and judged
  against the model's price class, see below.
- ❌ **FAIL** — no card rendered, or the run was stopped (irregularity, stuck
  pill, safety clock, runner error).

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
| turns                        | bot messages that carried usage                                                                                                                                                                                                                                                                                                          | 3 to 5 (one or two reads, one write, one show)                                                                                                                                                                                                              |
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

Known model profiles, so a result can be judged against expectations:

- Claude Sonnet 4.6, no effort set: the baseline. 3 to 4 turns, box markers,
  one mode switch at most, about $0.05. Its one failure mode is skipping the
  editing skill in its first read batch and writing git-style markers; the index
  skill now shows the block shape to prevent that.
- Claude Sonnet 5 at low or medium effort: fragments the work — one tool call
  per turn, placeholder calls, mode re-switches, the write deferred behind more
  reads. Anthropic's effort parameter budgets tool calls and text as well as
  thinking, so lower effort makes it avoid the one large write our workflow
  needs. At default (high) effort it overthinks for minutes instead. Not a
  usable default until the skills are rewritten for thinking-by-default models.
- Grok 4.5: about nine minutes per turn for some 200 output tokens, streaming
  reasoning the whole time. Unusable at that pace, and while it runs it holds
  its user's cost lock, so never run it as the same user as another model.
- GPT-5.4-mini: never writes. Asks permission, invents file reads that 404,
  stops after announcing the files. Not a building model.

## What the runner cannot tell you

- Whether the card looks right. Look at the screenshot.
- Why the host froze, when it did. That needs the tab's console; the runner
  keeps the room and the trace.
- Anything about a second turn in the same room (edits, follow-ups). One prompt
  per run, on purpose. Add a second `SMOKE_PROMPT` mode if that is ever needed.

## Changing the runner

`model-smoke.spec.ts` is the flow, `room-analysis.ts` the numbers,
`matrix-api.ts` the two matrix calls. Selectors are the host's `data-test-*`
attributes, used inline in each helper of the spec. If
the host changes a selector the run ends as `runner-failure` with the step name.
`pnpm lint` type-checks the package.
