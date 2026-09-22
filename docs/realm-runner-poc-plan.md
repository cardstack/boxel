# Realm runner POC

Status: discussion draft. Investigation only; no implementation has started.

## Goal and proposed scope

Let the in-app assistant create and edit realm source files through a host tool
that runs model-authored JavaScript in an isolated interpreter. Replace prose
prose editing markers with calls to a small `Realm` API, while retaining the
host's tool approvals, Matrix results, linting, and post-save feedback.

The POC should demonstrate a multi-file card build and a subsequent edit in one
selected writable realm. Start with `.gts`, `.ts`, and `.json` source files.
Keep the current patch path available for existing rooms and history. General
realm API access, persistent interpreter sessions, imports, arbitrary networking,
file deletion, a new diff UI, and server-side execution are later work.

Two proposed defaults are awaiting discussion:

1. Stage mutations during execution; save only after the script succeeds.
2. Require exactly one literal match for replacements.

These are API choices, independent of choosing QuickJS. A direct structured
editing tool could solve the prose-format problem with less machinery. The
runner adds the ability to compose operations, but also asks models to correctly
escape JavaScript strings inside tool arguments. Evaluate both the removal of
marker errors and the introduction of JavaScript syntax/escaping errors.

## What the existing code provides

| Area                  | Relevant code                                                                                                                           | Implication                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy matching       | the legacy prose-patch tool                                                                                                             | Marker parsing, indentation-insensitive matching, trailing-comma recovery, and first-match replacement are intertwined. A literal API should accept strings directly, without constructing marker blocks internally. |
| Patch orchestration   | `packages/host/app/tools/patch-code.ts`                                                                                                 | Reads source, patches, lints, handles filename collisions, tracks AI writes, and updates the open editor. Saves are currently started without awaiting completion; do not inherit that behavior in the runner.       |
| Source persistence    | `packages/host/app/services/card-service.ts`, `packages/host/app/resources/file.ts`                                                     | Reuse authenticated source reads/writes and editor/loader integration. Source writes work even when a card fails to index.                                                                                           |
| Tool registration     | `packages/host/app/lib/host-base-tool.ts`, `packages/host/app/tools/index.ts`, `packages/base/command.gts`                              | Add an ordinary host tool, register its module and class, and declare card-based input/result types. Input schema generation already exists.                                                                         |
| Tool lifecycle        | `packages/host/app/services/tool-service.ts`, `packages/host/app/lib/tool-auto-execute.ts`                                              | Reuse validation, execution ownership, approval/Act behavior, result events, and duplicate-call tracking. The generic timeout does not cancel execution.                                                             |
| Correctness           | `packages/ai-bot/lib/code-patch-correctness.ts`, `packages/runtime-common/ai/prompt.ts`, `packages/host/app/tools/check-correctness.ts` | Runner results are represented as applied source edits, so the existing post-result correctness continuation can check them after the tool result lands.                                                             |
| Recovery instructions | `packages/runtime-common/ai/prompt.ts`                                                                                                  | the correctness recovery instruction explicitly forbids tools. Make recovery aware of the available editing transport.                                                                                               |
| Worker packaging      | `packages/host/app/services/monaco-service.ts`, `packages/host/vite.config.mjs`                                                         | Production serves the bundle from a different origin than the page. Validate worker creation and WASM asset URLs in that arrangement, not only Vite development mode.                                                |
| Skill content         | Separate checkout at `packages/skills-realm/contents/`                                                                                  | Both `Skill/` cards and `skills/` markdown contain instructions. Editing guidance also appears in Boxel development and environment skills.                                                                          |

The raw-source endpoint in `packages/runtime-common/realm.ts`
(`replaceFileContent`) commits one file at a time. Its current path does not use
the conditional-write precondition used by card PATCH/DELETE. The existing
atomic-operations API also refuses module-source edits. Therefore, staging does
not give us atomic multi-file saves or race-free compare-and-swap writes.

## Proposed model-facing contract

Host tool module: `@cardstack/boxel-host/tools/run-realm-code`, default export.
The actual model-visible function name follows the existing generated hash
convention. Its required input is `code: string`, within the normal tool argument
envelope; the usual description supplies the user-facing label.

Treat `code` as an async function body so models can use `await` and an optional
JSON-compatible `return` without writing a wrapper:

```js
await Realm.createFile(
  'https://example.com/workspace/person.gts',
  'import { CardDef } from "@cardstack/base/card-api";\n' +
    'export class Person extends CardDef {}\n',
);

await Realm.replaceCode(
  'https://example.com/workspace/person.gts',
  'export class Person extends CardDef {}',
  'export class Person extends CardDef { static displayName = "Person"; }',
);
```

This is a transport example, not a complete card design.

| API                                               | Proposed behavior                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Realm.replaceCode(fileUrl, search, replacement)` | Existing file, nonempty search, exactly one literal occurrence. Zero matches and multiple matches produce distinct errors. Replacement is literal: `$&`, backslashes, and similar text are not replacement directives. Empty replacement deletes the matched text. |
| `Realm.createFile(fileUrl, content)`              | Explicit creation. Refuse an existing path, including an empty file; do not silently rename or overwrite.                                                                                                                                                          |

With staging, successful calls resolve with a small receipt saying **staged**.
Later calls see earlier staged content, and each file is saved once after the
script succeeds. Actual saved content may differ after formatting; the final
tool result reports this. Teach the assistant to re-read before its next edit.
Existing read-file tools provide source content for this POC.

If a capability call fails, invalidate the staged batch even if the script
catches its rejection. Treat unresolved capability calls at script completion
as an error; do not let an omitted `await` initiate late work after completion.
Serialize capability requests so concurrent calls cannot race the same buffer.

## Runtime and authority boundary

```mermaid
flowchart LR
  A[Assistant tool call] --> B[Host tool validation and approval]
  B --> C[QuickJS inside a Web Worker]
  C <-->|Small validated RPC messages| D[Host Realm adapter]
  D --> E[Staged file contents]
  E --> F[Lint and awaited saves]
  F --> G[Index and correctness feedback]
  G --> H[Existing Matrix tool result]
```

QuickJS is the guest-code boundary; the worker provides UI isolation and a
termination mechanism. The trusted worker bootstrap may load its own assets,
but guest JavaScript receives no browser globals, network API, storage,
credentials, Ember services, loader, or generic tool dispatcher.

Use a fresh runtime/context per invocation and load the dependency lazily.
Expose only the two capabilities above through copied strings and bounded data.
Validate argument types and sizes before copying guest values or making host
requests. Validate URLs and realm containment on the host, reject non-file
endpoints, and check write permission. Scope the POC to one host-bound writable
realm; a URL supplied by the model cannot widen that scope.

Bind room ID, tool-call ID, and realm scope through a host-created invocation
context. `ToolContext` currently contains only its stamp/Ember owner, so this is
explicit plumbing work. Never rely on a model-supplied room ID or use whichever
room happens to be open when an asynchronous callback finishes. If no suitable
realm can be bound, fail with a clear selection error.

Configure memory, stack, execution-time, source-size, operation-count, and result
limits. Use the QuickJS interrupt hook plus a host watchdog that terminates the
worker. Track a run token, reject RPC after closure, and clean up guest handles,
promises, timers, and pending reads. The standard synchronous WASM variant can
bridge ordinary async capabilities using guest promises and explicit pending-job
processing; Asyncify is not required for this API.

Limits must cover both execution and the host adapter. Once an HTTP save has
been sent, worker termination cannot guarantee it did not commit. Report an
uncertain write as such, stop issuing subsequent saves, and require re-reading
before retrying. Do not report it as a clean failure with no changes.

## Implementation steps

### 1. Prove the browser runtime integration

- Add a pinned QuickJS dependency through pnpm and a lazy worker entry.
- Build a small runner with one asynchronous test capability, bounded execution,
  rejected-promise handling, and deterministic disposal.
- Verify local and production-style worker/WASM loading, including cross-origin
  host assets. Reuse the approach established by Monaco where applicable.
- Exercise an infinite loop, unresolved promise, memory exhaustion, and repeated
  runs. Establish practical limits and measure bundle/cold-start cost.

Likely files: `packages/host/package.json`, `pnpm-lock.yaml`, new
`packages/host/app/lib/realm-runner/` modules and worker; Vite configuration only
if needed. Keep this stage independent of realm writes.

### 2. Implement the small Realm adapter

- Implement direct string matching and per-run staged contents without the
  legacy marker parser. Add explicit create semantics.
- Read real source with `cardService.getSource`; distinguish 404 from permission
  and server errors. Enforce scope, permissions, extensions, and size limits.
- Once execution succeeds, lint/autofix each changed source once and validate
  JSON syntax. Return unfixable lint/syntax diagnostics before committing.
- Check that originals still match and new paths are still absent immediately
  before saving. Detect an editor buffer that has diverged from persisted source
  and report a conflict rather than overwriting it.
- Await each save, preserve `bot-patch` request tracking, and integrate with the
  open file resource and loader refresh. Stop on a save failure and retain the
  per-file ledger of saved, failed, unattempted, or uncertain outcomes.

Likely files: new `packages/host/app/lib/realm-runner/realm-adapter.ts` and patch
session helper; `card-service.ts`/`resources/file.ts` only for necessary save or
cancellation plumbing. Reuse small helpers from the legacy patch orchestration where useful;
avoid coupling the new path back to prose parsing.

The pre-save comparison is best effort: another client can still write between
the check and POST. Record this as a POC limitation. A stronger guarantee needs
conditional raw-source writes under the server's write lock and is a separate
follow-up. Cross-file rollback is also outside this POC.

### 3. Connect the ordinary host tool and feedback

- Add `RunRealmCodeTool` and input/result card types; register in both the module
  shim and `HostToolClasses` so schema tests cover it.
- Supply trusted invocation metadata from `tool-service.ts`; reuse current
  approval/Act policy and execution ownership. Keep `requiresApproval: true` in
  the skill, which still permits automatic execution under the existing Act mode.
- Return bounded, host-generated file outcomes and diagnostics. Treat the
  optional guest return value as separate data, never evidence that saves ran.
- After all successful saves, emit the tool result with the affected files. The
  existing post-result correctness continuation then checks each touched target.
  Checks must run after the whole build and after the tool result lands, not
  halfway through creation of interdependent files.
- Keep persistence success distinct from indexing/render errors. Use existing
  failed tool status plus a result card for partial/uncertain execution; add the
  narrow result-status plumbing needed in `tool-service.ts` so it does not mark
  every returned result as successful or lose the saved-file ledger on throw.
- Bound the total lifecycle so the generic tool timeout cannot report failure
  while the runner quietly continues saving. If validation exhausts its budget,
  report saved files with validation pending/timed out.
- Use the current tool UI for the POC; make success/error and affected files
  understandable through its result card. Preserve duplicate-call protection
  and prevent replaying a partial run through the generic retry affordance.

Likely files: new `packages/host/app/tools/run-realm-code.ts`,
`packages/base/command.gts`, `packages/host/app/tools/index.ts`,
`packages/host/app/services/tool-service.ts`, and a host invocation-context type.
Use runtime imports for base module values, as other host tools do.

### 4. Make the assistant consistently choose the runner

- Start in an opt-in test room with an experimental skill declaring the new
  host tool. Ensure that room does not also receive unconditional prose-patch
  instructions from its other enabled skills.
- Coordinate changes in the separate boxel-skills repo: the source-editing,
  Boxel development, and environment guidance in both `skills/` and `Skill/`,
  plus their file-editing references. Prefer capability-aware guidance so older
  hosts can continue using the existing path.
- Document literal matching, explicit creation, awaiting calls, staged semantics,
  batching related files, JavaScript string escaping, and re-reading after
  formatter changes or failures. Keep code contents as strings, not executable
  card definitions inside the interpreter.
- Update hard-coded correctness recovery in
  `packages/runtime-common/ai/prompt.ts` to allow the runner when available and
  retain legacy instructions for legacy flows. Do not accidentally remove the
  bounded-repair behavior of the existing path; evaluate runner recovery loops.
- Deploy host support before enabling the skill on a shared environment. A
  boxel-cli plugin refresh is a later distribution step, not needed to test the
  in-app POC.

### 5. Validate behavior and compare model reliability

Add focused host unit/integration coverage for runtime isolation and limits;
literal/no/ambiguous matches; creation collisions; ordered same-file edits;
script failure with no saves; scope rejection; stale/editor content; awaited
save failures and partial/uncertain outcomes; cleanup after timeouts; formatting;
and post-save correctness feedback.

Add a narrow assistant acceptance test for declared-tool discovery, approval and
Act execution, result delivery/continuation, and duplicate-call handling. Extend
existing host schema tests and ai-bot prompt-construction tests where needed.
Use real QuickJS in runtime tests and the existing realm test harness for the
write path; do not substitute the sandbox with JavaScript `eval` in tests.

Build the host and run filtered QUnit suites, capturing full output in `/tmp/`.
Relevant existing suites include legacy patching,
`check-correctness`, host command schema generation, and tools acceptance tests.
Run `pnpm lint` in modified packages. Follow repository guidance for Glint type
checking; never invoke bare `tsc` or `glint --declaration`. Do not run the entire
host suite locally.

Manually compare representative assistant tasks on the same available models:
create a definition and instance, edit a template, edit two dependent files,
recover from a stale match, and generate content containing quotes, backticks,
`${...}`, backslashes, and the old marker strings. Record task completion,
malformed arguments/JavaScript, match failures, recovery turns, and elapsed time.
The POC succeeds when the full tool loop works without prose markers, failures
remain actionable, and reliability improves rather than merely changing the
syntax of failures.

## Runtime references

- [QuickJS embedding, promises, limits, and handle disposal](https://github.com/justjake/quickjs-emscripten)
- [QuickJS build variants; ordinary async works without Asyncify](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten-core/README.md)

Runtime suitability is based on documentation and code inspection; browser
packaging, performance, and isolation tests remain implementation work.
