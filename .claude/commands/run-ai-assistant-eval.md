---
description: Run one EvaluationCard against one or more models through the real assistant, judge each result against the card's success criteria, and record everything as cards. Asks which evaluation and which models when they are not given, and shows the browser as it works unless told otherwise. Usage /run-ai-assistant-eval [evaluation-card-url] [comma,separated,models] [headless]
---

Run an AI assistant evaluation end to end: `$ARGUMENTS`

The first token is the EvaluationCard URL, for example
`https://localhost:4201/user/evals/Evaluation/hello-world`. The second,
optional, token is a comma-separated list of models as the picker names them
(`"Claude Sonnet 4.6,GPT-5.5"`).

Every model run spends real money and takes minutes. Run each model once per
session. Never rerun a model whose result you have not read, and never loop.

## 1. Ask what to run

**Ask before anything else.** The only work that comes first is reading the
files the options are built from, named below. Nothing else happens until the
answer comes back — no `curl` of the stack, no `pnpm eval:setup`, no run. The
preflight is step 2 for a reason: starting it first burns time on a run that
may not be the one the user wanted, and a stack that is down is worth
reporting after the choice, not instead of it.

Look at `$ARGUMENTS`. Ask with one `AskUserQuestion` call carrying every
question it leaves unanswered:

- no EvaluationCard URL and no evaluation name → ask which evaluation
- no model list → ask which models
- nothing about the browser → ask whether to watch it

If it answers all three, skip straight to the preflight. Otherwise every
unanswered one goes in the same call, so the user answers once and the run
proceeds without further interruption.

**Which evaluation.** Read every `eval-realm/Evaluation/*.json` under
`packages/ai-assistant-evals` and take `data.attributes.cardInfo.name` and
`.summary` from each — never a hardcoded list, because evaluations are added
by dropping a file in that directory. List all of them in the reply, one line
each as `name — summary`. Then ask, with `hello-world` first (it is the
cheapest and the one to start from) and the rest by ascending cost, and say in
the question that "Other" takes any name from the list. An evaluation's URL is
`https://localhost:4201/user/evals/Evaluation/<file name without .json>`.

**Which models.** Ask as a multi-select. Build the options from the
ModelConfiguration cards the SystemCard offers
(`packages/catalog/contents/SystemCard/default.json` →
`relationships.modelConfigurations.*` → each card's `cardInfo.name`), because a
model the SystemCard does not list is not in the picker and the run fails at
model selection. Offer `Claude Sonnet 4.6` first as the recommended single
model, then the current `DEFAULT_MODELS` set from
`packages/ai-assistant-evals/run-eval.ts` as one option for a full cross-lab
sweep, then two other frontier models. Name the cost of each option in its
description: one model is minutes and cents, the four-model sweep is five to
fifteen minutes and dollars.

Take an answer the user typed into "Other" as given — it is a picker name or
an evaluation file name, not a new question.

**Whether to watch the browser.** Three options, watching first as the
default, because a run takes minutes and what the assistant does on screen is
most of what there is to see:

- **Watch it** — pass no flag. One headed browser with a window per model, all
  still running side by side, so watching costs no wall-clock.
- **Headless** — pass `--headless`. Nothing on screen.
- **One at a time** — pass `--headed`. A plain window, one model per turn; say
  in the description that this makes a sweep as long as the sum of its models.

Skip this question when the invocation already settled it — `headless` or
`no browser` in `$ARGUMENTS` means `--headless`, `headed` means `--headed`.

## 2. Preflight

- The dev stack is up: `curl -sk -o /dev/null -w '%{http_code}' https://localhost:4200/`
  prints `200`. If not, tell the user to start it (`mise run dev-all` with
  `OPENROUTER_API_KEY` set) and stop.
- The evaluations workspace exists and is current. From `packages/ai-assistant-evals`,
  `pnpm eval:setup` creates the writer's AI Assistant Evaluations workspace
  (endpoint `evals`) if needed and pushes
  `eval-realm/` into it; it is safe to run every time and takes seconds. Run
  it whenever the URL answers `404` or a file under `eval-realm/` changed.
- The eval users exist (`ai-assistant-eval-user-1` to `ai-assistant-eval-user-5`, password `password`). If the
  run fails at login, register them once from `packages/matrix`:
  `MATRIX_USERNAME=ai-assistant-eval-user-1 MATRIX_PASSWORD=password node ./scripts/register-test-user.ts`,
  per user.

## 3. Run

From `packages/ai-assistant-evals`:

```sh
pnpm eval <evaluation-card-url> ["Model A,Model B"] [--headless]
```

Run it in the background and follow its output; a session with four models
takes five to fifteen minutes. The browser opens on the user's screen, so say
in one line that it is running and that the windows are the run, not something
to click. The runner:

- creates a session id and an EvaluationReportCard in the evaluation's realm,
- per model, in parallel: logs in as its own matrix user, creates a fresh
  workspace, copies the evaluation's initial cards and files into it, opens the
  assistant, picks the model, sends the prompt (and the follow-up prompts, one
  at a time, once the assistant is idle), waits until the bot is idle, checks
  that a card rendered, screenshots, reads the room's events,
- writes one EvaluationResultCard per model with the mechanical numbers
  (verdict, turns, cost, caching rate, duration, tool calls, notes, the
  screenshot, the skills the room had) and an empty quality score,
- prints one line per model with the result card URL, and writes
  `eval-results/<session-id>/session.json` with everything.

Watch the console for the irregularities the `ai-assistant-evals` skill lists (a
failed pill, git-style markers, a repeated tool call, a stuck pill). The runner
stops such a run itself; do not stop a run for being slow or expensive.

## 4. Judge every result

The runner cannot tell whether the work was right. That is your job, per
model, from three sources:

1. The result JSON in `eval-results/<session-id>/<model>.json`: verdict,
   reasons, tool calls, blocks, files written, patch outcomes.
2. The screenshot next to it (open it with the Read tool).
3. The room, when anything is unclear or the run did not pass:
   `node .claude/skills/inspect-ai-room/scripts/inspect-room.mjs timeline '<roomId>'`
   from the repo root, and `usage` for the cache and cost per turn.

Take the evaluation's success criteria from `session.json`
(`evaluation.successCriteria`; they are numbered) and decide, one by one, with
evidence, whether each holds. Then score:

- **10**: every criterion holds.
- Otherwise start from 10 and take off `10 / n` per failed criterion (n =
  number of criteria), rounded to a whole number. A criterion that is half met
  (the field exists but is not shown, the edit landed but broke another view)
  counts as failed.
- **0**: the verdict is not `pass`, or no card of the asked-for kind exists
  in the test workspace. A pass with the wrong card (a placeholder, an
  unrelated card, only the pre-copied card untouched) is also 0.

Write the analysis as markdown: a checklist of the criteria with ✓ or ✗ and
one line of evidence each; then, for anything that failed or looked rough,
what went wrong and where the fix belongs, in this order of likelihood: the
skill text the model followed too literally or did not read, the prompt the
ai-bot builds, the host (a stuck pill, a rejected argument), the model itself.
Name the file or component for each suggested fix. Keep it under 30 lines.
Save it to `eval-results/<session-id>/<model>.analysis.md` and record it:

```sh
pnpm eval:judge <result-card-url> --score <0-10> --analysis-file eval-results/<session-id>/<model>.analysis.md
```

The card computes its effectiveness score (half the quality score, the rest
turns, cost, cache and time) and its tier: `failed` under 40, `rough` under
70, `good` under 85, `great` from 85.

## 5. Report

Reply with the report card URL, then one markdown table (not in a code
fence), one row per model:

| Tier | Model | Verdict | Quality | Turns | Cost | Cache | Time | Room |

Below it, one line per row that is not `great`: what went wrong and where the
fix belongs. Then the two money checks from the `ai-assistant-evals` skill: was the
cost reasonable for the model's price class, and did the prompt cache work
after the skill load. Do not paste the runner's console output or raw JSON.

When the user asked to circulate the results, also add the table and the
per-row lines as a comment on the Linear ticket they named, prefixed with
`_(Written by Claude on Matic's behalf.)_`.
