# Boxel Lint Workflow

Linting is part of the core Boxel code workflow. Every `.gts` change needs a real lint result before it is reported as done.

**Which context are you in?** Two execution contexts run this workflow, and they use different lint transports:

- **Shell contexts** (Claude Code, a terminal, CI, any agent with Bash): use the `npx boxel` CLI commands below. This is what CLAUDE.md and `boxel/SKILL.md` Cardinal Rule 9 refer to.
- **The in-app Boxel AI assistant** (no shell): use `checkCorrectness` (next section). The CLI commands are unavailable there — do not attempt them.

Both transports hit the same server-side lint gate; only the invocation differs.

## In the in-app Boxel AI assistant (no shell) — use `checkCorrectness`

The CLI sections below assume a shell. In the in-app assistant there is no shell, so **do not** try to run `npx boxel file lint`. After every applied code patch the assistant automatically issues a `checkCorrectness` command against each patched file (and each affected card instance). It runs the same server-side ESLint + `ember-template-lint` gate and returns the result inline as a card with `correct` (boolean), `errors` (string array), and `warnings` (string array). Clean means `correct: true` with an empty `errors` array — the same bar as `No lint issues found` / `messages: []` below.

The auto-fix loop is bounded (currently 3 attempts per target). Aim to emit clean code on the first pass rather than leaning on the retries — the recurring first-pass offenders (unused/duplicated imports, concatenated inline `style`, unlabeled inputs) are in the `SKILL.md` common-mistakes list. Everything under "What Lint Does NOT Catch" and "Completion Gate" applies to `checkCorrectness` too; the CLI-specific setup and command syntax do not.

## Required CLI

Use `@cardstack/boxel-cli` 0.2.0 or newer. Do not use a locally checked-out CLI unless the task is to debug CLI source.

**One-time setup per workspace.** A card workspace typically has no `package.json` of its own. Install the CLI as a local dep once, in the directory you run Boxel card work from, so `npx boxel` resolves cleanly:

```sh
# run from the root of the workspace directory you do card work in:
npm install @cardstack/boxel-cli@latest
```

The resulting `node_modules/`, `package.json`, and `package-lock.json` are gitignored; they exist only on your machine. Re-run after a pulled `lint-workflow.md` mentions a higher CLI version.

**Stale-shim detection.** A bare `boxel` can resolve to an old binary even when a newer one is installed. Symptom: `boxel --help` shows only `profile / realm / run-command` (no `file`, `lint`, `parse`). Resolution in order:

1. **Prefer `npx boxel`** when running from inside a workspace where the one-time install above has been run. `npx` resolves the local `node_modules` dep before falling back to PATH and reliably picks up the 0.2.0+ install.
2. `which -a boxel` shows every binary on PATH. The volta-managed one (`~/.volta/bin/boxel`) is usually the working 0.2.0+; `/usr/local/bin/boxel` is often the stale 0.0.1 shim.
3. As a last resort, invoke the dist entrypoint directly: `/path/to/boxel/packages/boxel-cli/bin/boxel.js`.

If after these steps you still don't see `file lint`, log the CLI gap explicitly — don't conclude the gate is unavailable.

## Commands

Before pushing, lint the local source file against its realm:

```sh
npx boxel file lint <realm-relative-path> --realm <realm-url> --file <absolute-local-file>
```

After pushing, lint the remote file from the realm:

```sh
npx boxel lint <realm-relative-path> --realm <realm-url>
```

For a broader pass, lint the whole realm:

```sh
npx boxel lint --realm <realm-url>
```

Useful JSON form:

```sh
npx boxel file lint <realm-relative-path> --realm <realm-url> --file <absolute-local-file> --json
npx boxel lint <realm-relative-path> --realm <realm-url> --json
```

## Interpreting Results

Clean lint means either:

- Human output: `No lint issues found`
- JSON output: `messages: []`

Do not treat transport success or `ok: true` as clean by itself. The lint endpoint can return `ok: true` with severity-2 `messages`; those still require repair.

## What Does Not Count

- The current monorepo CLI has no `npx boxel check`. It was a legacy standalone sync-state command; use `npx boxel file lint` / `npx boxel lint`.
- `_search-prerendered` does not replace lint. It is a server render check for supported formats. A direct `/_search-prerendered` probe is deployment-specific and, where exposed, uses HTTP `QUERY` rather than `GET` — for a server-side render check, prefer `npx boxel search --json` and inspect the returned HTML relationships, then open the card in the app to exercise `isolated`.
- Opening the card in the app does not replace lint. It exercises runtime rendering, especially isolated format.

## What Lint Does NOT Catch

`npx boxel file lint` clean is necessary but not sufficient. The realm-side lint endpoint is ESLint-style; it misses several runtime-only failure modes:

- **Missing strict-mode template-helper imports.** `(get @fields.X i)` in a template compiles fine through the lint pass but crashes the realm-server's strict-mode template compiler with `Attempted to resolve a helper… but that value was not in scope`. Import every helper you use: `import { get, fn, hash, array, concat } from '@ember/helper';`. See `common-imports.md`.
- **Schema/value type mismatches** — `contains(DateField)` with an ISO-datetime value, or `contains(DateTimeField)` with a date-only value. Lint passes; the file writes; the indexer accepts it; only at render time does `date-fns format()` throw `RangeError: Invalid time value`. See `base-field-catalog.md` "DateField vs DateTimeField — the schema-vs-value contract".
- **Cross-module shape contracts** that aren't visible in a single file (a `linksTo(SomeCard)` whose target file is broken; a query referencing a `codeRef` to a module that doesn't export the named class).

**Pair lint with a runtime instantiation** when a kit is "done":

```sh
npx boxel run-command @cardstack/boxel-host/tools/instantiate-card/default \
  --realm <url> \
  --input '{"moduleIdentifier":"<module-url>","cardName":"<ClassName>","realmIdentifier":"<url>"}'
```

A clean instantiate-card result (`passed: true, error: null`) is much closer to "actually working" than a clean lint result.

## Completion Gate

For `.gts` work, the minimum validation set is:

1. Import preflight from `common-imports.md`.
2. Local `npx boxel file lint ... --file <local-file>`.
3. Push/sync/upload.
4. Remote `npx boxel lint <path> --realm <realm-url>`.
5. Render validation for affected cards/formats when user-facing behavior changed.

If the lint command is genuinely unavailable, say that explicitly, log the CLI gap, and run server-side render validation as a fallback. That fallback is not a clean lint.
