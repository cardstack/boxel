# AGENTS.md - Boxel CLI Codex Guidance

## High-Priority Safety Rules

1. Create a checkpoint before destructive operations:
   - `boxel history . -m "Before destructive operation"`
2. After restore, always sync with local preference:
   - `boxel history . -r <checkpoint>`
   - `boxel sync . --prefer-local`
3. Stop watch before restore to avoid re-pulling deleted files.
4. When watch is running and you edit files locally, use edit locks:
   - `boxel edit . <file>` before editing
   - `boxel edit . --done <file>` after sync
5. Write clean source code, never compiled wire-format output for `.gts` files.

## Mission

This repo is part of a software factory where humans do not inspect or hand-edit code directly.

The goal is to:

- Accept a user request
- Break it down into persistent tasks
- Implement the work incrementally
- Test each step
- Commit or checkpoint progress continuously
- Store the plan, tickets, and knowledge base in Boxel so future runs become more reliable

Code and project state should live in Boxel realms. Tickets and knowledge cards are the persistent memory for the factory.

## Current Environment

- Active Boxel CLI user: `factory`
- Do not put passwords directly into shell commands. If re-auth is needed, use `BOXEL_PASSWORD` or interactive login.
- Realm server: `http://localhost:4201/`
- Matrix server: `http://localhost:8008`
- `boxel list` currently shows access to:
  - `http://localhost:4201/factory/guidance-tasks/`
- Check out Boxel workspaces into the local `realms/` subfolder under this repo
- Ignore `dark-factory`; it was an earlier iteration and should not be used as the current target
- Task tracker modules live in the `guidance-tasks` workspace under module `darkfactory`
- There are demo instances in that workspace that should be inspected before inventing new task structures
- Tickets may live in a dedicated task realm or in the realm created for a specific solution, but they should reuse the tracker module instead of duplicating it

## Factory Execution Model

When given a product request, the default operating loop is:

1. Discover the relevant realms, modules, and existing task or knowledge cards
2. Choose or create the target implementation realm
3. Break the request into tickets, milestones, or task cards in Boxel
4. Add or update knowledge-base cards that capture decisions, constraints, and reusable procedures
5. Implement work one task at a time
6. Test after each meaningful change
7. Checkpoint with Boxel history and commit in git when a git repo exists
8. Sync changes back to Boxel and continue iterating until the request is demonstrably working

Persistent Boxel artifacts are part of the deliverable, not just code.

## Immediate Demo Priority

There is one hour to produce an end-to-end demo of this workflow.

Bias toward:

- A small but complete project
- Visible task breakdown into tickets
- Clear knowledge-base entries
- Repeated task -> implement -> test -> checkpoint loops
- Fast feedback over architectural perfection

## Auth and Testing Notes

- Prefer Boxel CLI capabilities over rebuilding the same behavior from scratch
- Additional tooling is allowed when the CLI does not cover the task cleanly
- You will likely need auth helpers that can obtain JWTs for accessible realms
- The `_server-session` endpoint can provide JWTs for realms the current user can access
- Authenticated card URLs open directly into interact mode, which is the preferred surface for browser testing and Playwright-based verification
- Explore search and query options in the tracker and workspace data model before creating new structures
- Project tests should live in Boxel realms when they are part of the product's persistent memory
- Preferred convention:
  - realm-local Playwright specs live under `tests/**/*.spec.mjs`
  - files copied into disposable verification realms live under `tests/fixtures/**`
  - fixture contents are copied to the scratch realm root preserving paths, so `tests/fixtures/DeliveryBrief/example.json` becomes `DeliveryBrief/example.json` in the scratch realm
- Run realm-hosted tests with:
  - `npm run test:realm -- --realm-path ./realms/<project-realm>`
- The default runner flow is:
  1. create a fresh scratch realm
  2. pull it locally under the canonical workspace path `realms/<host>/<owner>/<scratch-realm>/`
  3. copy fixture files from the source realm into the scratch realm
  4. sync the scratch realm
  5. run the source realm's Playwright specs against the scratch realm URL
  6. report failures and keep the scratch realm available for inspection
- When fixture instances depend on card definitions from the source realm, prefer absolute `meta.adoptsFrom.module` URLs so the scratch realm only needs the copied instances

## Boxel Development Trigger

When tasks involve Boxel card development, automatically consult:

- `.agents/skills/boxel-development/SKILL.md`
- `.agents/skills/software-factory-operations/SKILL.md` when the task is about ticket-driven application delivery, realm coordination, or the end-to-end factory loop

The shared repo-local skills live in `.agents/skills/`.
Claude should read them through `.claude/skills/`, which should point at the same directory to avoid duplicate instructions.

Trigger examples:

- Editing `.gts` card definitions
- Editing card instance `.json`
- Asking for Boxel card patterns/components
- Working in a synced workspace (`.boxel-sync.json` present)

## Core Command Semantics

- `pull`: remote -> local
- `push`: local -> remote
- `sync`: bidirectional conflict resolution
- `track`: local file watching with auto-checkpoints (use `--push` for real-time server sync)
- `watch`: remote change watching (pulls server changes)
- `repair-realm`: repair one realm metadata + starter cards + optional Matrix reconciliation
- `repair-realms`: batch repair all owned realms and reconcile Matrix realm list

After local edits tracked with `track`, push to server with:

- `boxel sync . --prefer-local`
- Or use `boxel track . --push` for automatic real-time sync

## Onboarding Flow (When Needed)

If user has no profile configured:

1. `npx boxel profile`
2. `npx boxel profile add` (interactive preferred)
3. `npx boxel list`
4. First sync/pull into local workspace

If `boxel list` already works, treat onboarding as complete and move on to workspace discovery.

Security note:

- Prefer interactive password entry or `BOXEL_PASSWORD` env var.
- Avoid plain `-p` password usage in shell history.

## Multi-Realm Guidance

- Configure realms with `boxel realms --add ...`
- Use `boxel realms --llm` for file-placement guidance.
- This repo already includes `.boxel-workspaces.json` mapping `guidance-tasks` as the shared tracker realm and `software-factory-demo` as the default implementation realm.
- Heuristic:
  - `.gts` -> code realm (`*.gts` pattern)
  - instances -> realm mapped for card type
  - ambiguous -> default realm

## Boxel URL Handling

Boxel app URLs usually reference private, authenticated content.

- Do not fetch them from the public web.
- Parse card path from URL and locate local synced file instead.
  Example:
- URL segment `Document/<id>` maps to local `Document/<id>.json`

## Useful Workflows

### Local dev loop (manual sync)

1. `boxel track .`
2. edit files
3. `boxel sync . --prefer-local`

### Local dev loop (real-time sync)

1. `boxel track . --push`
2. edit files (changes auto-pushed via batch upload)

### Monitor server changes

1. `boxel watch .`
2. inspect checkpoints with `boxel history .`

### Restore workflow

1. stop watch
2. `boxel history . -r <checkpoint>`
3. `boxel sync . --prefer-local`

### Software Factory Loop

1. `boxel list`
2. sync the relevant realm locally
3. inspect existing task and knowledge cards
4. create or update tickets for the requested outcome
5. implement in the target realm
6. store or update project tests inside the target realm when they are part of the deliverable
7. test using CLI plus authenticated browser flows where useful
8. prefer a disposable scratch realm for fixture-driven browser verification
9. report issues back into tickets or knowledge cards
10. sync to the realm
11. checkpoint and sync
12. update knowledge cards with what was learned

## Related References

- `.claude/CLAUDE.md`
- `.agents/skills/boxel-development/SKILL.md`
- `.agents/skills/boxel-file-structure/SKILL.md`
- `.agents/skills/boxel-repair/SKILL.md`
- `.agents/skills/boxel-sync/SKILL.md`
- `.agents/skills/boxel-watch/SKILL.md`
- `.agents/skills/boxel-track/SKILL.md`
- `.agents/skills/boxel-restore/SKILL.md`
- `.agents/skills/boxel-setup/SKILL.md`
- `.agents/skills/software-factory-operations/SKILL.md`

## Share & Gather (GitHub Workflow)

Share workspace to GitHub repo, gather changes back:

```bash
boxel share . -t /path/to/repo -b branch-name --no-pr
boxel gather . -s /path/to/repo
```

**URL Portability:** Share/gather automatically convert absolute realm URLs in `index.json` and `cards-grid.json` to relative paths, making content portable across different realms.
