# Command Invocation Modes

A single `Command` subclass can be exposed to users through multiple entry points. The class itself doesn't change — what changes is _how_ and _where_ it gets invoked. This doc names the modes, when to use each, and how to compose them.

> **Why this matters:** A well-designed Command is invocation-agnostic. The same class can serve as a menu item on a card, a button in a template, a step inside an AI agent, a one-shot CLI script, or a typed run card with full history. Picking the right invocation mode is downstream of the Command's logic — and you can layer modes (menu item + CLI scriptable + reactive resource) on the same class.

## The modes

_TODO: fill in the recommended use cases + worked snippets for each mode. The skeletons below name the surfaces; the patterns each row references already exist (or are scheduled to)._

| Mode                                                                                | When to use                                                                                                                                         | Pattern                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Direct call** — `new MyCommand(ctx).execute(input)`                               | _TODO_ Inside another Command, inside a tracked task, inside an action method. The lowest-level form.                                               | `boxel/references/command-development.md` (opening sections) |
| **Reactive resource** — `commandData<T>(this, MyCommand)`                           | _TODO_ A Glimmer component needs the command's _result_, rendered reactively when it resolves. Replaces hand-rolled `restartableTask` + `@tracked`. | `command-data-resource`                                      |
| **Card menu item** — `[getCardMenuItems]`                                           | _TODO_ The Command is an action the user takes _on a specific card_ — generate avatar, send to printer, refresh from source.                        | `link-command-menu-item`                                     |
| **Typed run card with progress** — `@tracked progressStep` on the Command class     | _TODO_ The user wants to watch a long-running operation (upload, AI call, migration) progress through named phases.                                 | `command-typed-with-progress`                                |
| **Optimistic run-card pipeline** — durable run card with steps + logs               | _TODO_ Multi-step workflow (LLM call → file write → save → index) that needs an auditable history record. The card _is_ the history.                | `command-optimistic-pipeline`                                |
| **One-shot AI processor** — wraps `OneShotLlmRequestCommand`                        | _TODO_ Single LLM call, no conversation. Classification, summarization, JSON extraction from a card.                                                | `integrate-one-shot-llm`                                     |
| **Multi-turn AI assistant** — opens an AI room with a Skill card pre-loaded         | _TODO_ User wants to _talk_ to an AI about this card. The card provides framing (skill + attached cards), then steps out.                           | `command-with-skill-card-ref`                                |
| **CLI script with history** — `npx boxel run-command <spec> --input '{}'`           | _TODO_ Headless / batch invocation, ad-hoc scripting, scheduled jobs, "run this on every card matching X."                                          | `automate-run-command-cli`                                   |
| **Atomic transactional install** — `PlanBuilder` + `ExecuteAtomicOperationsCommand` | _TODO_ The Command writes many things and they must all land or none of them. Catalog install/remix is the canonical case.                          | `command-atomic-install`                                     |

## The same Command, five ways

_TODO: a single canonical `MyCommand` class shown wired up to each mode. This is the **payoff** of this reference doc — readers see one class served five ways and understand the layering._

```ts
// _TODO: MyCommand class definition — Command<typeof MyInput, typeof MyResult>_
// _TODO: input CardDef + result CardDef shape_
// _TODO: minimal run() body_
```

**Direct call from another Command:**

```ts
// _TODO: const result = await new MyCommand(ctx).execute(input);_
```

**Reactive resource in a template:**

```ts
// _TODO: data = commandData<typeof MyResult>(this, MyCommand);_
// _TODO: template reads data.cardResult, data.isSuccess, data.cardError_
```

**Card menu item:**

```ts
// _TODO: [getCardMenuItems](params) returning { label, icon, action } that calls execute_
```

**CLI script:**

```bash
# _TODO: npx boxel run-command '<realm>/MyCommand' --realm <url> --input '{"foo":"bar"}'_
# _TODO: pipe --json output through jq for scripting_
```

**Run card with progress:**

```ts
// _TODO: @tracked progressStep on the Command class + a run-card linksTo in the input_
```

## Picking the mode

_TODO: a short decision tree._

- **User clicks something on the card itself** → card menu item (`link-command-menu-item`).
- **Template renders a value** → reactive resource (`command-data-resource`).
- **Long-running, observable** → progress (`command-typed-with-progress`) or full run card (`command-optimistic-pipeline`).
- **Headless / batch / cron** → CLI (`automate-run-command-cli`).
- **AI in the loop** → one-shot (`integrate-one-shot-llm`) or multi-turn (`command-with-skill-card-ref`).
- **Atomic multi-write** → transactional install (`command-atomic-install`).

## Layering modes

_TODO: examples of the same Command exposed via multiple modes at once._

- A Command can be **both** a menu item **and** CLI-invokable — the menu item passes input from the card's fields, the CLI passes input from a JSON string. The `execute()` body is identical.
- A Command that writes a typed run card (`command-optimistic-pipeline`) is automatically CLI-friendly — `npx boxel run-command` returns the run card's URL, which any downstream script can query for the trace.
- A reactive `commandData<T>` resource in an `isolated` template + a menu item with the same Command class lets the user _see_ the result live AND _trigger_ a refresh manually.

## Anti-patterns

_TODO: capture the common confusions._

- ❌ **Direct `fetch` instead of `SendRequestViaProxyCommand`** — fetch bypasses the realm proxy's credentials handling. Use the host command.
- ❌ **Hand-rolled `restartableTask` for a one-shot read** — `commandData<T>` is the typed, reactive replacement.
- ❌ **Burying multi-step logic inside one `run()` block with no run card** — for anything observable, lift the steps into a run card with logs (`command-optimistic-pipeline`).
- ❌ **Putting menu integration in `command-development.md` only** — discoverable via `link-command-menu-item` pattern now; the reference is for the run-time mechanics.

## See also

- `boxel/references/command-development.md` — the run-time mechanics (input validation, host commands, OpenRouter, progress tracking).
- `boxel-create-edit-cards/SKILL.md` — host-command combinations for card creation/editing flows.
- `boxel-patterns/references/integration-surfaces.md` §3 — full host-command catalogue.
- `boxel-patterns/references/integration-surfaces.md` §10 — `npx boxel run-command` CLI surface.
