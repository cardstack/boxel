# CS-13484: Compare realm-server suite time across dates — plan

## Goal

A script that answers "which test files did the realm-server suite's time go
to since date X". It compares `packages/realm-server/tests/test-module-timings.json`
at two points in history. The shard-timings job commits that file on main
several times a day, so its history is enough: the script needs no CI artifacts.

## Scope change

The ticket proposed a scheduled job that opens a Linear issue when the total
grows more than 15%. We did not build it:

- The cause of the Sep–Oct buildup (modules that index realms before every
  test) now has a lint rule, `@cardstack/boxel/realm-server-test-template-database`
  (#6557, merged 2026-10-08). The rule stops that cause on the PR that adds it.
- Growth that remains is many reasonable files that add up. The usual fix for
  that is to add a shard, not to change the files.
- An automatic ticket without a triage owner becomes a warning that nobody
  reads.

The comparison was the part of the manual investigation that took effort, so
we built only that.

## What was built

- `packages/realm-server/scripts/compare-test-module-timings.mjs`
  - `--since <date|ref>` (default 21 days ago), `--until <date|ref>` (default
    HEAD), `--shard-count <n>` (optional, prints time per shard), `--top <n>`.
  - A date resolves to the last commit to the timings file on or before that
    day.
  - Output: total time then and now, time per shard, file counts, the files
    that grew most (new files included), the files that shrank most, and
    removed files.
  - Test counts come from `git grep -c` for `test(` calls at the later
    revision, so they are approximate.
- `packages/realm-server/tests/compare-test-module-timings-test.ts`: tests for
  the pure `compareTimings` function.
- One line in the realm-server section of `AGENTS.md`.

## Check

`node scripts/compare-test-module-timings.mjs --since 2026-09-10 --until 2026-10-02 --shard-count 6`
shows 12.3 → 24.5 min per shard, and the realm-policy suites at the top of the
list. This is the same result as the manual investigation in CS-13469.
