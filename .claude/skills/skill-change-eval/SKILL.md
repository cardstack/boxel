---
name: skill-change-eval
description: Before a change to the boxel-skills content (cardstack/boxel-skills) that targets a core use case of the AI assistant, write or pick an EvaluationCard that shows the problem the change fixes, run it with and without the change on the same code, and put the evidence in the PR. The core use cases are (1) creating or updating card instances, (2) creating or updating card definitions, (3) navigating the Boxel UI, and (4) bulk update operations. Also covers deciding who consumes the changed text (the in-app AI assistant, Claude Code through the boxel-skills plugin, or both) and which builds it applies to, the cost check against the small-card evaluations, and what a reviewer should ask for when a skill PR has no eval. Use when writing, changing, or reviewing a boxel-skills PR, when editing files under `packages/skills-realm/contents/`, when someone asks "does this skill change help the assistant", or when a skill change is suspected of making the assistant worse.
---

# Evals for skill changes

The boxel-skills content has two consumers: the in-app AI assistant, which
reads it from the skills realm, and Claude Code, which reads it through the
boxel-skills plugin. They behave differently. Claude Code has a shell,
`boxel-cli`, and the whole repo. The assistant has `run-realm-code`, works to
a turn and cost budget, and is graded on both. A rule that helps Claude Code
can make the assistant slower or more expensive, and a test in Claude Code
shows nothing about the assistant.

Every rule has a benefit and a cost. The benefit shows on the builds the rule
is for; the cost shows on every build the rule fires on. So a skill change
that targets one of the four core use cases ships with evidence of both:

1. **the problem** — an eval fails, without the change, at the thing the
   change is meant to fix;
2. **the improvement** — the same eval passes that point with the change;
3. **the cost** — the small-card evals (`hello-world`,
   `linkedin-profile-computed-edit-restyle`) take no more turns, money or time
   with the change than without it.

A rule whose benefit no eval checks shows only its cost. A Pre-flight rule
meant for apps and pages, with no limit in its text, fires on a three-field
card too: it adds reads, captures and turns there, and the quality score
cannot rise because the small card already scores full marks.

The core use cases:

| #   | Use case                          | What the eval's workspace starts with                                           |
| --- | --------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Create or update card instances   | nothing (create), or a definition and instances in `initialCards` (update)      |
| 2   | Create or update card definitions | nothing (create), or the `.gts` in `initialFiles` and its instances (update)    |
| 3   | Navigate the Boxel UI             | the cards the user wants to reach, so the prompt can name them                  |
| 4   | Bulk update operations            | a definition and enough instances that one-at-a-time editing shows (10 or more) |

A change outside these (a typo, a reference page only Claude Code reads, a
pattern nothing loads by default) needs no eval of its own, but it still needs
the cost check if it touches a file the assistant reads on every build:
`index.md`, the `boxel` skill, `boxel-environment`, `source-code-editing`, the
cardinal rules.

Read the `ai-assistant-evals` skill and the `/run-ai-assistant-eval` command
(`.claude/commands/run-ai-assistant-eval.md`) first. They cover the stack, the
eval users, running, judging, and reading results. This skill covers what to
run and what counts as evidence.

## 1. Say who the change is for

Before writing anything, state in the PR description:

- which consumer the change is for: the assistant, Claude Code, or both;
- which builds it applies to: any card, or only an app, a card family or a
  page. A rule meant for big builds says so in its own text, or it fires on a
  three-field card too;
- which core use case it targets, by number;
- the observed failure it fixes: a local eval room id (`inspect-ai-room` reads
  it), an eval result card, or a Claude Code transcript. "The model might" is
  not an observed failure. A staging or production room is a user's DM with
  the bot: describe what happened in the PR and put the room id in the Linear
  ticket, as `pr-privacy` says.

A change written for Claude Code still reaches the assistant if it lands in a
file the assistant reads. Either put it where only Claude Code looks, or treat
it as a change for both and run the eval.

## 2. Find or write the eval

Look under `packages/ai-assistant-evals/eval-realm/Evaluation/` first. Use an
existing evaluation only if its success criteria already include one that
fails because of the problem. Otherwise add a new one.

A new evaluation is one JSON file, `<use-case>-<problem>.json`, shaped like
`linkedin-profile-computed-edit-restyle.json`. Getting it right:

- **Size it like the builds the rule is for.** A rule for apps is shown on an
  app-sized prompt (a card family with a Home), not on a single card. Set
  `secondsPerPrompt` on a bigger build, so the time target is not the 200
  seconds set for hello-world.
- **The prompt is what a user would type.** It names the outcome, never the
  fix. If the change teaches `realm.fs.replace` for in-place edits, the prompt
  says "add a company field to my profile card", not "edit the file in place".
  A prompt that asks for the fix measures nothing about the skill.
- **One criterion is the problem criterion.** Mark it in the criterion text
  (`(problem)`) so the judge and the reviewer can find it. It must be
  checkable from the workspace snapshot or the room, not from the screenshot:
  a file count, a `computeVia` in the `.gts`, a tool call that does or does not
  appear, a turn count.
- **The other criteria say the job got done.** A fix that makes the problem
  criterion pass by breaking the build is not a fix.
- **Seed the workspace for update and bulk evals.** Put the starting cards and
  files under `eval-realm/` and name them in `initialCards` / `initialFiles`.
  The runner copies them in at the same relative paths.
- **End on a card the assistant created.** The runner grades `pass` only when
  the assistant applied at least one `run-realm-code` write or other writing
  tool call and a card rendered with no error, and the rendered check skips
  every card in `initialCards`. An update, bulk or navigation eval (use cases
  1 and 2 update, 3, 4) that ends on a seeded card it edited is graded
  `model-failure` however well it went, on both sides, so the comparison
  measures nothing. Until the runner counts an edited seeded card, such an
  eval's prompt also asks for one new card the user would want from the
  task, for example "mark every overdue invoice paid and make me a summary
  card of what changed".
- **Fill `cardInfo.name` and `cardInfo.summary`.** The `/run-ai-assistant-eval`
  command lists evaluations by them. The summary says what the prompts ask and
  what the eval tests.

## 3. Agree the run plan

Every run costs money and minutes. Before starting, tell the user the plan,
with a cost estimate, and wait for a yes:

- **Evals:** the target eval and the two small-card evals.
- **Models:** three, because they react differently to the same text. The
  SystemCard's default model, a small Claude model, and one model from another
  lab. A model that already reads widely barely notices an extra "read this
  first" rule, while one with a short path to the result pays for it in
  turns; one model shows half the story.
- **Runs:** three per model per side. One run is too noisy to call a
  difference (the `ai-assistant-evals` skill lists the models that give
  different grades on different runs), and three show a direction. The
  `/run-ai-assistant-eval` command runs each model once per session, so the
  three runs are three sessions, each started with all three models after
  the previous session's results are read and judged.

## 4. Run without and with the change

The local stack serves skills from `packages/skills-realm/contents/`, a clone
of boxel-skills. Whatever is checked out there is what the assistant reads.
Edits to the skill files there need no restart, and the runner opens a new
room per run, which a skill change needs.

The two sides differ in the change and nothing else: the same boxel commit,
the same day, the same models. There are two ways to get them.

- **A skill feature (preferred for `index.md`).** Markers work only in
  `index.md`: the ai-bot strips feature sections from the instructions of the
  skills a room enables, and the default system card enables only
  `index.md`. Every other skill file reaches the assistant through
  `readRealmFile` with its sections intact, so a change marked there is on
  both sides. For a change in `index.md`, put the changed section between
  `<!-- feature:<name> -->` and `<!-- /feature:<name> -->`, register the
  name in `SKILL_FEATURES` in `packages/runtime-common/ai/debug.ts`, and
  restart the ai-bot (`mise run services:ai-bot` after stopping the running
  one), which reads that map only at start; until then every "with" run
  stops with "no skill feature named". One branch then gives both sides:
  `EVAL_SKILL_FEATURES=<name> pnpm eval …` for "with", and plain
  `pnpm eval …` (or `EVAL_SKILL_FEATURES=-<name>` when the evaluation's
  `skillFeatures` switches it on) for "without". The section stays out of
  every assistant prompt for as long as the markers remain: nothing turns a
  feature on for every room. Shipping a change for the assistant takes two
  PRs, in this order: the boxel-skills PR removes the markers, then a boxel
  PR drops the name from `SKILL_FEATURES` and from every evaluation's
  `skillFeatures`, which would otherwise fail to switch it on. A change meant
  only for Claude Code keeps the markers, which is how it ships without
  touching the assistant.
- **Two branches,** for a change anywhere but `index.md`. Make the "without"
  side from the PR branch with the change reverted, not from `main`, because
  `main` may have moved under the PR. To measure rules that are already merged, revert them on a scratch
  branch of `main`.

1. `git -C packages/skills-realm/contents status` must be clean. From
   `packages/ai-assistant-evals`, run `pnpm eval:setup` (it pushes a new
   evaluation).
2. **Without.** Check out the PR branch (feature off) or the "without"
   branch in `packages/skills-realm/contents/` and run every eval in the plan through
   `/run-ai-assistant-eval`, judging each result.
3. **Check the problem shows.** The problem criterion must fail in at least
   two of the three runs of each model. If it passes, the eval does not show
   the problem: rewrite the prompt or the seed until it does, or conclude the
   problem is not where the change assumes. Do not run the "with" side on an
   eval that already passes.
4. **With.** Turn the feature on, or check out the PR branch, and run the
   same evals with the same models.
5. **Restore.** Check `main` back out in `packages/skills-realm/contents/`, so
   later runs do not read a scratch branch by accident.

## 5. Read the evidence

Compare per model, on the averages of the three runs.

A run with a `host-failure`, `bot-failure` or `runner-failure` verdict is
unscored: it says nothing about the skill. Leave it out of the averages and,
once its result is read, run that model again in a session of its own.

Both sides are called by the same rule, a majority of a model's three runs.
The change helps a model when the problem criterion failed in at least two
"without" runs and held in at least two "with" runs, and every other
criterion held in at least two "with" runs.

The change costs nothing when, on each small-card eval and each model, the
"with" average takes no more turns, cost or time than the "without" average
(a 10 percent wobble is noise at three runs) and the quality score is no
lower. A clear rise blocks the change, whatever the target eval says, until
the rooms explain it (`inspect-ai-room`): the extra reads, captures or tool
calls the change added, and whether the rule should apply to that build at
all. The usual fix is to limit the rule to the builds it is for.

A mixed result (the change helps some models and not others) is not
evidence. Read the rooms of the models it did not help and find out why
before running more.

## 6. Put it in the PR

The evaluation JSON and any seed cards go in a PR to cardstack/boxel. The
boxel-skills PR links it. Its description carries one table, one row per eval,
model and side, with the averages of the three runs:

| Eval | Model | Side | Problem criterion held | Quality | Effectiveness | Turns | Cost | Time |
| ---- | ----- | ---- | ---------------------- | ------- | ------------- | ----- | ---- | ---- |

"Without" rows first. One line under it says what changed and why, and links
the EvaluationReport cards if they live on a shared stack.

## Reviewing a skill PR

A boxel-skills PR that targets a core use case and has no eval table gets one
request: the eval that shows the problem, and the with/without numbers. A
table whose problem criterion holds without the change does not show the
problem. A table with no small-card rows does not show what the change costs.
A rule written for apps or pages whose text does not say so will fire on
every build: ask for the limit in the text. A change meant for the assistant that still sits
between feature markers reaches no one: ask for the markers to come out.
