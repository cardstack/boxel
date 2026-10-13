# CS-13668: the correctness-check success prompt shrinks the final answer to one sentence

## Goal

After a file write passes the automated correctness check, the assistant must still deliver
its full answer: what it built, how to use it, the answer to anything the user asked in the
same message, and any closing line a skill requires. The failure path (a check that reports
errors) behaves exactly as before.

## The bug

All in `packages/runtime-common/ai/prompt.ts`:

- `CORRECTNESS_SUCCESS_SUMMARY_INSTRUCTION` read: "Summarize the results above in one short
  sentence confirming that the target is now auto-corrected. Mention any warnings if they
  exist. Do not mention correctness or automated checks or tool calls."
- `toCheckCorrectnessResultContent` attaches it as `followUpUserMessage` whenever the result
  card has no errors. Failures get `CODE_FIX_INSTRUCTION` or, after three attempts,
  `CORRECTNESS_FAILURE_LIMIT_INSTRUCTION`.
- History building turns a check-correctness tool result into a `role: 'tool'` message plus a
  separate `role: 'user'` message carrying the follow-up. The model sees a fresh user turn
  after the tool result that asks for one sentence, and obeys it instead of the real user's
  request from earlier in the turn.
- `CHECK_CORRECTNESS_SUMMARY_INSTRUCTION` rides the volatile trailing context message whenever
  the last history event is a check-correctness result. It already says "If work you already
  described remains unfinished, carry straight on with it in the same reply". So on a clean
  check the model reads both notes; both say "one short sentence", and only the trailing one
  says to carry on, and only for work already described, which never covers a question the
  user asked before the save.

Evidence: the catalog-reuse evaluation `reuse-service-desk-build` (Gemini 3.5 Flash and GPT-6
Luna ended both turns with a one-sentence acknowledgement and skipped the required ownership
line), and a persona test on production with GPT-6 Luna whose two replies that ended on a clean
check were one sentence and skipped what the user asked for. Details are on the Linear ticket.

## Assumptions

- The success note stays a `role: 'user'` follow-up after the tool results, so the history
  shape, and therefore the prompt cache, does not change.
- `CHECK_CORRECTNESS_SUMMARY_INSTRUCTION` keeps its text and still fires after a batch with a
  failed check. After a clean batch it is left out, so the success note is the last
  instruction the model reads.

## Steps

1. Reword the success instruction so the check note is at most one line of the reply, and the
   model then answers everything the user's last message asked for, any closing line its skills
   require, and any change it made unasked, with the same carry-on clause as the sibling.
2. Leave the trailing `CHECK_CORRECTNESS_SUMMARY_INSTRUCTION` out when every check in the
   batch was applied with no errors, so nothing after the success note asks for one sentence.
3. Send one follow-up per distinct note in a batch, not one per check: a batch of four passing
   checks gets the success note once.
4. Tests in `packages/ai-bot/tests/prompt-construction-test.ts`: a passing batch of two checks
   gets the success note once, right after the results, and no user-role message asks for one
   sentence or for fixes. The trailing-summary test uses a failed check and also asserts the
   fix instruction. The attempt-cap and attempt-reset tests pass unedited.
5. Run `pnpm test` in ai-bot and `pnpm lint` in runtime-common and ai-bot.
6. Add an evaluation that grades the final reply after a clean check, and run it before and
   after the fix on GPT-6 Luna and Gemini 3.5 Flash, with Claude Sonnet 4.6 as control. Its
   criteria require a passing check before the final reply, so a pass shows the bug path ran.

## Target files

- `packages/runtime-common/ai/prompt.ts`
- `packages/ai-bot/tests/prompt-construction-test.ts`
- `packages/ai-assistant-evals/eval-realm/Evaluation/reading-list-save-then-answer.json`
- `packages/ai-assistant-evals/README.md`

## Evaluation results (local stack, 2026-10-13)

`reading-list-save-then-answer`: build a small card with three instances, then, once
everything is saved, list the unfinished books and end with a line starting "Next step:".

| Instruction  | Model             | Verdict       | Quality | Final reply                                                 |
| ------------ | ----------------- | ------------- | ------- | ----------------------------------------------------------- |
| original     | GPT-6 Luna        | pass          | 4/10    | one sentence: saved and "auto-corrected", nothing asked for |
| original     | Gemini 3.5 Flash  | model-failure | 0/10    | stopped before writing; no check ran                        |
| fixed        | GPT-6 Luna        | pass          | 10/10   | full answer, unfinished list, "Next step:" line             |
| fixed        | Claude Sonnet 4.6 | pass          | 10/10   | full answer, unfinished list, "Next step:" line             |
| fixed        | Gemini 3.5 Flash  | model-failure | 0/10    | full answer after a clean check, but never called show-card |
| review fixes | GPT-6 Luna        | pass          | 10/10   | full answer, unfinished list, "Next step:" line             |
| review fixes | Claude Sonnet 4.6 | pass          | 10/10   | full answer, unfinished list, "Next step:" line             |

The "review fixes" rows ran with the success note sent once per batch and no trailing summary after a clean batch. They used the prompt that says any look is fine: without it, GPT-6 Luna twice read the design skill and asked how the list should feel before writing anything.

## Out of scope

- Gemini 3.5 Flash claiming a card is shown without calling show-card. It is unrelated to the
  correctness instruction and is tracked in CS-13835.
