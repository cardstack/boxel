---
name: catalog-pairing
description: How a boxel pull request and a boxel-catalog pull request that depend on each other are paired — a `Merges before:` / `Merges after:` line in each description naming the other, declared from both sides — and which merges first. Covers when a change needs a pair (a boxel change the catalog's cards must follow, such as renaming or removing a host tool, command, base export or type the catalog imports; or a catalog definition boxel's tests need first), the declaration syntax and the rules a declaration must meet, merge order in each direction and in the three-PR flow, what boxel's Lint Catalog does with the pairing (it lints the paired catalog pull request's head and refuses to let catalog main be left broken behind a pull request that isn't ready), and how to read its failures. Use before opening or editing any pull request in cardstack/boxel-catalog; before opening a boxel pull request that changes something boxel-catalog's cards import or that pins or tests a catalog change; whenever Lint Catalog fails; and whenever a check says `pairing:`, "doesn't name … back", "waiting on cardstack/boxel-catalog#… to merge", "is not approved yet", "pair the two", or "Merges before" / "Merges after".
---

# Pairing boxel and boxel-catalog pull requests

This repo's `PreToolUse` hook (`.claude/hooks/require-skill.mjs`) refuses to open or edit a boxel-catalog pull request, or to write a `Merges before:` / `Merges after:` line into any pull request's description, through `gh pr` or the GitHub MCP tools, until the session or subagent has loaded this skill.

boxel-catalog's cards import boxel (host tools, `@cardstack/base`, runtime types), and boxel's tests use some catalog definitions. So a change in one repository can need a change in the other, and the two pull requests have to be checked together and merged in the right order. Each pull request says which pull request it pairs with in its description, and the checks in both repositories read that.

## When a change needs a pair

- **A boxel change the catalog has to follow.** Renaming or removing a host tool or command (`@cardstack/boxel-host/tools/*`), a base export, a field or a type that catalog cards import, or tightening a type or lint rule they trip. The boxel pull request merges first, and the catalog pull request that adapts the cards merges right after it.
- **A catalog change boxel's tests need.** A new or changed definition in the catalog test subset (the `catalog-test-subset` skill). The catalog pull request merges first, and the boxel pull request that re-pins and tests it merges after.
- **Both at once: the three-PR flow.** A catalog definition that needs new platform code, and whose boxel tests need the new definition. Platform pull request A merges, then catalog pull request C, then boxel pull request B, which re-pins and tests. C is tested against B's head, and that head needs A's platform code. So B carries A by merging A's branch into it and following A until A merges. B still targets `main`, like every pull request in a pair.

A change that keeps working against the other repository's `main` needs no pair. Lint Catalog checks exactly that, so an unneeded pair costs nothing and a missing one fails.

## The declaration

Each pull request of a pair has one line in its description naming the other. The key states this pull request's merge order relative to the one it names:

```
Merges before: cardstack/boxel-catalog#123
```

```
Merges after: https://github.com/cardstack/boxel/pull/456
```

- **Both sides, inverse keys.** If boxel pull request A says `Merges before` naming catalog pull request C, then C says `Merges after` naming A. A declaration that the other side doesn't return fails, so a typo or a stale pointer can't pair two unrelated changes.
- **The named pull request must be valid.** It exists, is open or already merged, targets `main`, and comes from a branch of its own repository, not a fork. Both sides name each other under inverse keys only: naming the same pull request under both keys, or both sides using the same key, fails.
- **At most one line per key.** In the three-PR flow, C has one of each: `Merges after` naming A, and `Merges before` naming B.
- **Line format.** The key is case-insensitive and starts its line; a list marker or wrapping backticks are fine. The value is `owner/repo#N` or the pull request's URL. Lines inside fenced code blocks or HTML comments are ignored, so put any example of the syntax in a code block, or mid-sentence, never at the start of a line of prose.
- **Edits re-run the check, but only on its own side.** Editing a boxel pull request's description re-runs Lint Catalog. The boxel run lints the catalog head it read when it ran, and nothing in the other repository triggers it. So re-run the boxel pull request's Lint Catalog by hand after any change on the catalog side: its description, its approval, or a push. boxel-catalog keeps approvals across pushes, so a green boxel check can be judging an older catalog head.

Edit a description with `gh pr edit <n> --repo <owner/repo> --body-file <file>` only after checking that the file isn't empty. A failed fetch that leaves the file empty blanks the description.

## What the checks do with it

**boxel's Lint Catalog** (`.github/workflows/lint-catalog.yaml`, `packages/catalog/scripts/pairing.ts` and `lint-sweep.ts`):

1. It reads this pull request's declaration and checks it from both sides. A problem fails the job immediately, naming the line to add or fix and the pull request it belongs on.
2. It lints the paired catalog pull request's head against the change, in place of catalog `main`. That is the `Merges after` pair if it's unmerged, since it lands first, otherwise the `Merges before` pair. Errors there are for the catalog pull request to fix.
3. It also lints catalog `main` against the change, against the base branch too, so only errors this change adds count. If the change adds errors to catalog `main`:
   - **`Merges after` pair unmerged**: fails with `waiting on cardstack/boxel-catalog#N to merge`. Re-run after it merges. This comes first, because that pull request has to land before this one.
   - **`Merges before` pair open, ready for review and approved** (GitHub's own review decision): passes, and says to merge the catalog pull request right after this one.
   - **`Merges before` pair still a draft, not approved, or approval unreadable**: fails, saying which. Fix that, then re-run.
   - **No pair**: fails with the two exact lines to add. If the declared `Merges before` pair has already merged, it says to replace that line. Alternatively, keep the change compatible with catalog `main`.

**boxel-catalog's Boxel Test Subset** pairs by branch name: it tests a catalog pull request against the boxel branch with the same name, or against boxel `main` if there is none. So give the two branches the same name as well, and push the boxel branch first.

**boxel's Catalog Test Subset** pin check needs no declaration. The pinned commit identifies its catalog pull request, and the check fails until that pull request merges.

## Merging

- **Boxel first:** merge the boxel pull request only once its catalog pull request is approved, then merge the catalog one right after. Until the catalog one merges, catalog `main` fails against boxel `main`, and boxel-catalog CI is red for everyone.
- **Catalog first:** merge the catalog pull request, re-pin the boxel pull request onto catalog `main` (`pnpm --dir packages/catalog catalog:test-subset --bump`), re-run its checks, then merge it.
- **Each environment gets the catalog on its own schedule.** Staging syncs catalog `main` on every catalog merge. Production gets only what boxel-catalog's "Deploy to production" deploys: the revision boxel pins, before and after Manual Deploy [boxel] to production releases, or a catalog `main` revision someone deploys by hand. That deploy refuses while a catalog pull request in it says `Merges after:` a boxel pull request production doesn't run. So a catalog change that needs boxel code declares its pair even when Lint Catalog wouldn't require one. The `catalog-deploy` skill covers the deploy and its refusals.
