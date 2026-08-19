---
name: flaky-test-fix
description: Investigate and fix a flaky test reported by a CI failure URL (e.g. a GitHub Actions job link) or a known-flaky test name. Use whenever someone hands over a flaky/intermittent test and wants it fixed — not skipped or retried. Triggers on "this test is flaky: <URL>", "intermittent failure in <test>", or a CI job link for a test that passes on re-run.
---

# Flaky Test Fix

A flaky test reported by a CI URL is a request for four things, done in order: **prior-art search → worktree → root-cause fix → diagnostic logging**. Do not paper over the failure with a retry, an increased timeout, or a `skip`/`todo` unless the failure genuinely cannot be diagnosed without more data — and if so, lead with the diagnostics and say so explicitly.

## Why this protocol

Flaky tests are uncertain by nature. A fix that looks correct in local repro often does not address the real race / ordering / resource issue that triggers it in CI. Two safeguards counter that:

- **Prior-art search** catches the common case where the same test has been "fixed" before. Without that context you risk re-doing a fix that already proved insufficient, or undoing an intentional accommodation.
- **Diagnostic logging bundled with the fix** means that if the fix misses the real root cause, the *next* CI failure produces enough signal to diagnose it — instead of burning another CI cycle staring at the same opaque output.

## Procedure

### 1. Search for prior fix attempts first

Before touching anything, find out whether this test has been worked on before. Search by test name, file path, and failure signature:

```bash
gh search prs "<test name or file>"   # searches open + closed by default
gh pr list --state=all --search "<test name or failure signature>"
git log --oneline -- <path/to/test/file>
```

If you find a prior PR, read its description, diff, and review thread before designing your fix. You may be looking at a regression, a partial fix, or a class of flakiness someone has already characterized. Surface any prior attempts early so the reporter can weigh in if the new fix should look materially different from the last.

### 2. Work in a worktree off `origin/main`

Spawn a fresh git worktree based on `origin/main` (not the current branch) and do all the work there — never in the main checkout — unless an active ticket-specific override says otherwise. Prefer launching an Agent with `isolation: "worktree"` for this.

### 3. Attempt a real fix for the root cause

Diagnose the actual race, ordering, or resource issue and fix that. If a prior attempt exists, explicitly account for why this fix will succeed where the previous one didn't — or why it is complementary rather than a repeat.

### 4. Add diagnostic logging alongside the fix

Add logging that would make the *next* failure diagnosable if this fix turns out not to catch the root cause. The logging is insurance: it stays in even when the fix looks obviously right. Aim it at the uncertain part — the timing, the ordering, the shared resource state — so a future CI failure prints the signal you wished you'd had this time.

## When the failure isn't fixable yet

If there genuinely isn't enough information to identify a root cause, don't guess at a fix. Land the diagnostic logging on its own, say clearly that it's diagnostics-only, and explain what signal the next failure will produce.

## Related repo conventions

- Reproduce locally with a tight loop (stop on first failure) rather than waiting out the full suite.
- For host integration tests, watch for shared global state leaking across tests (a frequent flakiness source) — register/unregister symmetry, store/loader resets, lingering DOM or timers.
