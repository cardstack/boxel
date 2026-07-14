---
validated: source-proven
---

# automate-run-command-cli — Invoke a Command from the shell via `npx boxel run-command`

**What this gives you:** A Command class you authored for your realm becomes invokable from the shell. When paired with a typed run card, every invocation leaves an auditable trace — a queryable card with steps, logs, progress, errors, and outputs — without writing a separate logging layer.

**When to use:**

- Batch jobs (reindex, regenerate thumbnails, sync from upstream) that you'd otherwise run by hand inside the host UI.
- Cron / scheduled tasks — a CI job calls `npx boxel run-command` on a schedule.
- CI gates — a deploy script checks an exit code or parses the JSON output.
- One-off realm migrations after a schema change (see `boxel-migrate-schema`).

**The insight:** A Command class is already a typed function (`Input → Output`) with `commandContext` access to host primitives. The CLI loads the module, instantiates the Command with a synthetic `commandContext`, builds the input card from `--input`, runs it, and prints the output as JSON. No re-implementation needed; the same Command works from a card menu, a Glimmer component, and the shell.

## Invocation shape

```sh
npx boxel run-command \
  'https://<realm>/example::ReindexCommand' \
  --realm 'https://<realm>/' \
  --input '{ "targetRealm": "https://<realm>/" }' \
  --json
```

The first argument is the Command's module spec: realm URL, `::`, exported class name.

## Recipe shape

```ts
import { Command } from 'https://cardstack.com/base/command';

export class ReindexInput extends CardDef {
  @field targetRealm = contains(StringField);
}

export class ReindexOutput extends CardDef {
  @field success = contains(StringField);
  @field count = contains(StringField);
  @field message = contains(StringField);
}

export class ReindexCommand extends Command<
  typeof ReindexInput,
  typeof ReindexOutput
> {
  static displayName = 'Reindex Command';
  static description = 'Re-index every card in the target realm.';

  async getInputType() {
    return ReindexInput;
  }

  protected async run(input: ReindexInput): Promise<ReindexOutput> {
    const output = new ReindexOutput();
    // ... do the work via this.commandContext ...
    return output;
  }
}
```

## Pairing with a run card

For history-on-write, link the Command output to a Run CardDef that captures status, steps, logs, start/end timestamps. Persist the run card from inside `run()` and return its URL — every CLI invocation then leaves a queryable trail in the realm. See `command-optimistic-pipeline` for the mutate-in-place + fire-and-forget save shape and `command-typed-with-progress` for the progress-step state machine.

## Conventions

- **`getInputType()` is required.** The CLI uses it to instantiate the input class from the `--input` JSON. Fields not on the class are dropped silently — keep the input shape narrow.
- **Use `this.commandContext` for IO.** `SendRequestViaProxyCommand`, `SaveCardCommand`, `SearchCardsByQueryCommand`, etc. — same primitives as in-app, no host UI assumed.
- **Decide the error convention up front.** Most commands prefer to set `output.success = 'false'` and exit 0 so the JSON parses cleanly — useful when the caller is another script. Throw for genuinely exceptional cases when you want a non-zero exit (cron alerting).
- **Static `description` is exposed to `--help`.** Write it for the operator who is reading the shell help text, not the developer.

## Gotchas

- **Module URLs must be reachable from the CLI host.** Local realms behind auth need credentials configured in `~/.config/boxel-cli` or via `BOXEL_TOKEN`.
- **`commandContext` from the CLI lacks browser features.** Anything that calls `document` or `window` will fail. Keep `run()` server-friendly.
- **Output cards are NOT auto-saved.** Returning a new `ReindexOutput()` prints its serialized JSON; if you want the run history in the realm, call `SaveCardCommand` explicitly.

## Source

- `realms-staging.stack.cards/ctse/personal/save-image-command.gts` — minimal Input/Output/Command shape. Lines 1–84.
- `boxel/references/command-invocation-modes.md` — the CLI mode in the wider Command invocation taxonomy (direct call, reactive resource, menu, typed progress, CLI, atomic install, AI processor).
- `boxel/references/command-development.md` — Command class internals.

## See also

- `command-optimistic-pipeline` — durable run cards with fire-and-forget saves.
- `command-typed-with-progress` — progress-step state machine the calling UI reflects.
- `boxel-migrate-schema` — typical CLI caller for schema migrations.
