# e2e: model smoke runner

Asks each model in a list to build a hello-world card in a fresh workspace and
show it, through the real host, the real ai-bot, and the real provider. One
row per model at the end: did a card render, how many turns, which tools, what
it cost. Use it to decide which models the SystemCard should list.

## Run

Start the dev stack first (`mise run dev-all` with `OPENROUTER_API_KEY` set for
the ai-bot). Then, from `packages/e2e`:

```sh
SMOKE_MODELS="Claude Sonnet 4.6,Claude Opus 4.8" pnpm smoke
```

`pnpm smoke:headed` shows the browser, one model at a time. `pnpm smoke:tabs` opens
every model as a tab of one headed browser and runs them at once.

- `SMOKE_MODELS` — comma-separated model names as the picker shows them
  (substring match, case-insensitive, must match exactly one option). The
  picker keys options by ModelConfiguration card id, not model id, so names
  are the stable handle; the model id actually used is read back from the room
  and recorded. Default: `Claude Sonnet 4.6`.
- `SMOKE_PROMPT` — the prompt to send. Default: `create a hello world card and show it`.
- `SMOKE_USER` / `SMOKE_PASSWORD` — local matrix user. Default `user` / `password`.
- `SMOKE_HOST_URL`, `SMOKE_MATRIX_URL` — default `https://localhost:4200`,
  `http://localhost:8008`.
- `SMOKE_MAX_MINUTES` (default 15) is a safety net only: a run still going after
  that is stopped. Nothing else about pace stops a run; slow runs are graded.
- `SMOKE_BOT_USER` — the ai-bot's matrix id. Default `@aibot:localhost`.

Results land in `smoke-results/` (git-ignored): `summary.md` (the table), one
JSON and one screenshot per model, and Playwright traces for failed runs.
A run also prints the table at the end.

## What a run does

1. Logs in, creates a new workspace with a unique name, enters it.
2. Opens the assistant, creates a room, selects the model, keeps mode `act`.
3. Sends the prompt and waits until the bot is idle: no message streaming, no
   tool pill applying or waiting for approval, no pending Accept. The run is cut
   short only when it has clearly gone wrong (a failed or invalid tool call, an
   error alert, a patch the host cannot apply, the same call repeated three
   times, a pill stuck past the host's tool timeout) or after the safety wall
   clock.
4. Looks for a rendered card in the stack that is not the workspace index and
   has no error state; screenshots the page.
5. Reads the room's Matrix events: turns, tokens, cost, tool calls and their
   outcomes, SEARCH/REPLACE blocks and their marker style, files written.
6. Classifies: `pass` (card rendered), `model` failure (never wrote, wrong
   markers, wrong tool, gave up), or `host` failure (a pill stuck applying, a
   tool with no result, the tab left the workspace). Keeps the room id so the
   room can be inspected afterwards.

Models run in parallel, `SMOKE_WORKERS` at a time (default 5), each in its own
browser context, workspace, and room; the ai-bot works rooms concurrently. All
workers log in as the same user, so their starts are staggered
(`SMOKE_STAGGER_SECONDS`, default 20) to keep the room-opening steps apart, and
a run fails itself if a second prompt shows up in its room. `smoke:headed` runs
one worker so there is one window to watch.

The `model-e2e` skill in `.claude/skills/model-e2e/SKILL.md` explains the benchmarks and how to read a run.
