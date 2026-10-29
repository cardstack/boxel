# The UI lens

Runs in any review of a UI change: a card or field template, a component defined in a realm, a component in `packages/host`, `packages/pretui`, `packages/boxel-ui` or `packages/catalog`, or the scoped styles of any of them. It adds two lenses to the review's own: the `boxel-ui-guidelines` UI review procedure, and better-interface's six domains. Their findings are classified, written and reported like any other finding of the review that loads this file (`pr-review`, `review-branch`, or a code review asked to run it); this file covers only what to load and what to look for.

Host app chrome (`packages/host/app/components/**`) isn't user-themed: no card or user theme reaches it, so the `font:` shorthand and raw palette shades (`--boxel-800`, `--boxel-light`) are its house style and aren't findings. A host component that uses contract tokens under `data-theme='light'` or `'dark'` (the dashboard, the sign-in screens) follows the token rules for those tokens.

A PR in `cardstack/boxel-catalog` or `cardstack/boxel-home` is realm code, and is reviewed from the boxel monorepo: check out its head in a worktree of the matching nested checkout (`packages/catalog/contents` or `packages/boxel-homepage-realm/contents`), and read `theme.css`, `variables.css` and the `fetch:skills` cache from the monorepo. Pass `--repo cardstack/boxel-catalog` or `--repo cardstack/boxel-home` to every `gh` call, and run `scripts/adr-for.mts` from the monorepo with each changed path prefixed by the nested checkout's path.

## 1. Load the contracts

Load `gts-component-conventions` when the scope has a `.gts` file.

Load `interfaces:better-interface`, and through it every domain skill in its order: `better-accessibility`, `better-layout`, `better-writing`, `better-typography`, `better-colors`, `better-ui`. When the `interfaces` plugin isn't installed, say, where the review states what it covered, that `better-interface` wasn't reviewed, and run the guidelines procedure alone. Mark any single domain that fails to load as not reviewed.

Skip better-interface's §2 ("Send a change to `interface-review`"). It refuses to resolve a change scope and asks the user to run `interface-review`, which only the user can start. This lens takes `interface-review`'s place instead: read the plugin's `installPath` for `interfaces@interfaces` from `installed_plugins.json` in the plugins root (`$CLAUDE_CODE_PLUGIN_CACHE_DIR`, or `$HOME/.claude/plugins` when it's unset), then read `skills/interface-review/SKILL.md`, `scope-resolution.md` and `removed-signals.md` under that path, and use them to resolve the change scope and the removed signals. Don't pick a version from the cache directory, which keeps old versions. Its report format, severity ladder and verdict don't apply; the review's own classes and blocking calls do.

Read these in full; they are the rule book, not background:

- The `boxel-ui-guidelines` skill's `references/ui-review-procedure.md`, `references/checklist.md` and `references/theme-token-contract.md` (roles, guaranteed pairs). The skill comes from the `boxel-skills` plugin; without it, read them from the `fetch:skills` cache, as AGENTS.md's "UI changes" section describes.
- `packages/boxel-ui/src/styles/theme.css` and `variables.css`, the only token sources that exist.

## 2. What to look for

Run both lenses over **every touched UI file, whole file, not just the diff**, as it is at the head under review: the PR's worktree, or for a branch read from its ref, `git show <ref>:<file>` and `git grep <pattern> <ref> -- <files>`. A hit in lines the change didn't write is pre-existing, and is classified as such.

- **UI review procedure**: steps 0–9, starting with the step-0 grep over each file. Every hit is either a finding or deliberately left; a hit left as it is goes in the report to the user with its reason, never in anything posted to the PR. The checklist and the token contract own the rules. On top of them, these hold for code in this repo:
  - **No Pret UI season tokens.** `--season-*`, `--step-*`, `--type-*`, `--leading-*`, `--round-*`, `--ink-2`, `--ink-3`, `--state-*`, `--text-ui-*`, `--text-body`, `--space-*`, `--track-*`, `--radius-*` and the `--pretui-*` colors (`--pretui-info`, `--pretui-attention`, `--pretui-attention-ink`, `--pretui-on-neutral`, `--pretui-primary-ink`, `--pretui-link`, `--pretui-destructive-ink`) are undefined in Boxel; a reference resolves to its fallback, or to nothing. A fallback doesn't make one acceptable. Map each to its theme-contract replacement, for example `--pretui-attention` → `--attention-ink` for text and `--attention` for fills, `--pretui-primary-ink`/`--pretui-link`/`--state-live` → `--primary-ink`, `--pretui-destructive-ink`/`--state-failed` → `--destructive-ink`, `--ink-2` → `--muted-foreground`, `--ink-3` → `--subtle-foreground`. Pret UI code is not precedent for this or for any other checklist rule.
  - A private name over a contract token is an alias layer, unless several declarations read it to stay equal (a negative margin and its matching padding). Count the uses before flagging one.
  - Element order exception: an attribute the component's correctness depends on (`type='button'` on a native button, `aria-hidden` on decorative markup, an `id` another element points at, a `role` its keyboard handling assumes) goes after `...attributes`, with a short comment saying why.
  - Icons come from `@cardstack/boxel-icons`, sized with `width`/`height` attributes.
  - American spelling is preferred in code, comments and copy. A British spelling is a non-blocking nit, raised only in lines the change wrote, and grouped into one finding.
- **better-interface**: all six domains over the change scope, expanding the changed files to the surfaces they affect, and reading the `-` side of each hunk for removed signals. Walk every state: hover, active, focus, disabled, loading, empty, error, and narrow width. Each root cause is one finding, under the domain that owns its rule. Its escalation triggers (an interactive control with no accessible name, a keyboard-reachable control with no visible focus indicator, and the rest of its list) are blocking.
- **Rendering.** Render only an app that serves the code under review: the working tree, only when the review is of the working tree; for a branch or a PR, an environment running its head (a preview the author or reviewer started). Don't start or switch a dev server for the review. A check that needs rendering and has no such app is not a finding; ask it as a question only when the answer changes what the author does.
- **Measure, don't assert.** Compute contrast from the values in `theme.css`/`variables.css` against the boxel default theme, light and dark, and give the ratio in the finding.

Where the review states what it covered (pr-review's lens sentence, review-branch's overall assessment), it names the UI lenses that ran, and any domain that didn't.
