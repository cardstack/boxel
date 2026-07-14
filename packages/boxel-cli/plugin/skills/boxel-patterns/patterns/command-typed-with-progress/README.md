---
validated: source-proven
---

# command-typed-with-progress — Command with tracked progressStep state machine

**What this gives you:** A Command subclass that exposes a `@tracked progressStep` field consumers can read to drive UI through a multi-step operation (upload → parse → save → finish). The card invoking the command can show a live status without polling or callback plumbing.

**When to use:** Any Command whose `run()` takes longer than ~500ms and goes through distinguishable phases. Especially uploads, AI calls, multi-step migrations, anything the user wants to watch.

**The insight:** Boxel Commands aren't fire-and-forget — they're CardDefs themselves. So `@tracked` fields on the Command instance are reactive in the host. Define your progress states as a string-literal union, store the current step as `@tracked progressStep: UploadProgressStep`, mutate it as work proceeds, and the invoking template renders the latest value automatically.

**Recipe shape:**

1. Define a string-literal union for the steps (`'uploading' | 'parsing' | 'saving' | 'done'`).
2. Subclass `Command<Input, Output>`, add `@tracked progressStep: ProgressStep = 'idle'`.
3. Inside `run()`, update `this.progressStep` at the start of each phase.
4. Store the final value as `this.result` for the caller to read after.
5. In the invoking component, use `restartableTask` and read `command.progressStep` in the template.

**Gotchas:**

- `progressStep` must be a `@tracked` property, not a getter. Tracked storage is what makes the template auto-update.
- Don't `await` work _before_ setting the first step — the user should see `'uploading'` immediately.
- Reset to `'idle'` (or your initial state) at the start of every `run()` if the Command instance might be re-run.

**Source:** catalog-realm `commands/upload-image.ts:16-25` (the union), `:57-64` (the tracked field), `commands/create-real-image.gts:31-40` (consumer pattern).

**See also:** `command-with-skill-card-ref`, `boxel/references/command-development.md`.
