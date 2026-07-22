import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from 'https://cardstack.com/base/command';

// 🧩 PATTERN: a Command shaped for shell invocation.
//
// Once a Command lives in a realm module, it becomes invokable from
// the shell:
//
//   npx boxel run-command \
//     'https://<realm>/example::ReindexCommand' \
//     --realm 'https://<realm>/' \
//     --input '{ "targetRealm": "https://<realm>/" }' \
//     --json
//
// The CLI loads the module, instantiates the Command with a synthetic
// commandContext, builds the input card from `--input`, runs it, and
// prints the output card as JSON. Use this for batch jobs, cron,
// CI gates, or any time you want to fire a typed action without the
// host UI.

export class ReindexInput extends CardDef {
  static displayName = 'Reindex Input';
  @field targetRealm = contains(StringField);
}

export class ReindexOutput extends CardDef {
  static displayName = 'Reindex Output';
  @field success = contains(StringField); // "true" | "false"
  @field message = contains(StringField);
  @field count = contains(StringField); // serialized number — CLI JSON is permissive
}

export class ReindexCommand extends Command<
  typeof ReindexInput,
  typeof ReindexOutput
> {
  static displayName = 'Reindex Command';
  static description =
    'Re-index every card in the target realm and report the count.';

  async getInputType() {
    return ReindexInput;
  }

  protected async run(input: ReindexInput): Promise<ReindexOutput> {
    const output = new ReindexOutput();

    try {
      // Stand-in: replace with a real call (SendRequestViaProxyCommand,
      // SearchCardsCommand, etc.). The shape is what matters — pure
      // input → output, no UI side effects.
      const count = await reindexRealm(input.targetRealm);

      output.success = 'true';
      output.count = String(count);
      output.message = `Re-indexed ${count} cards in ${input.targetRealm}.`;
    } catch (error: any) {
      output.success = 'false';
      output.message = error?.message ?? 'Unknown error';
    }

    return output;
  }
}

// Plug in your real work here.
async function reindexRealm(realm: string): Promise<number> {
  // For a CLI tool, lean on host commands from `this.commandContext`:
  //   const search = new SearchCardsByQueryCommand(this.commandContext);
  //   const { cardIds } = await search.execute({ query: ..., realms: [realm] });
  //   ...
  // Use SaveCardCommand to write, SendRequestViaProxyCommand to call
  // external HTTP, etc. — same primitives as in-app, no host UI assumed.
  void realm;
  return 0;
}

// --- Notes ---
//
// - Pair with a run-card CardDef (`status`, `startedAt`, `completedAt`,
//   `logs[]`, `steps[]`) if you want a queryable history of every CLI
//   invocation. See `command-optimistic-pipeline` for the
//   mutate-in-place + fire-and-forget SaveCardCommand shape, and
//   `command-typed-with-progress` for the progress-step state machine.
//
// - The `--input '{}'` JSON is parsed into a fresh instance of the
//   class returned by `getInputType()`. Fields that aren't on the
//   class are dropped silently. Keep the input shape narrow.
//
// - Errors bubble up as a non-zero exit code only if `run()` throws.
//   Most commands prefer to set `output.success = 'false'` and exit 0
//   so the run-card serializes cleanly — pick the convention that
//   matches the caller (cron wants exit codes; an interactive shell
//   often wants the structured JSON).
