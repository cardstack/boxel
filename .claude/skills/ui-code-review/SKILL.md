---
name: ui-code-review
description: Review local, unpushed UI changes — the working tree and the branch's commits over main — with the UI lens (the boxel-ui-guidelines UI review procedure and better-interface's six domains) plus pr-review's correctness and classification, and report the findings in the terminal. Nothing is posted, and no file is edited until the user picks which findings to fix. Use when asked to review local UI changes before pushing, to UI-review or design-review the working tree, a branch that has no PR yet, or uncommitted template, component or scoped-style edits. For an open pull request use pr-review; for a guided tour of a pushed branch use review-branch.
argument-hint: '[base-ref | --uncommitted]'
allowed-tools: Read, Grep, Glob, Bash(git merge-base *, git diff *, git log *, git ls-files *, git grep *, git rev-parse *, git status *, gh pr view *, gh api repos/*/pulls/*/comments *, node scripts/adr-for.mts *)
---

# UI code review

Reviews the code in the current checkout, as it is on disk, before it reaches a pull request. The rules live in the UI lens, `.claude/skills/pr-review/references/ui-lens.md`; this skill resolves a local change scope, runs that lens over it, and reports in the terminal. It never switches branches, stashes, commits, pushes or posts.

## 1. Resolve the change scope

- No argument: everything the branch adds over `main`. The base is `git merge-base HEAD origin/main`, and the scope also takes in staged, unstaged and untracked files.
- A ref: the same, with that ref as the base.
- `--uncommitted`: only staged, unstaged and untracked files, against `HEAD`.

Build the file list from `git diff --name-only <base>`, `git diff --name-only --cached` and `git ls-files --others --exclude-standard`. Hunks come from `git diff -U0 <base>`; an untracked file counts as wholly added. Read every file from the working tree, since that is what is under review.

If no file in scope is a UI change, as `ui-lens.md` defines it, say so and stop: this is the wrong review for the change.

Done when: the base, the file list, and the lines the change wrote are known.

## 2. Context

- `git log --oneline <base>..HEAD` for what is already committed.
- `node scripts/adr-for.mts <files>` lists the ADRs whose scope covers the change; read each `accepted` or `proposed` one before judging it.
- If the branch already has an open pull request, read its review bodies and comments (`gh pr view --json number,url,reviews,comments`) and its inline review threads (`gh api repos/{owner}/{repo}/pulls/{n}/comments --paginate`, which `gh pr view` doesn't return), so a finding already raised there gets one pointer line instead of a repeat. No pull request is the common case; skip this then.

## 3. Run the UI lens in full

Follow `ui-lens.md` §1 and §2 over the scope from step 1, reading from the working tree. Reading the file is not running it: load, with the Skill tool, every skill its §1 names, then run the `boxel-ui-guidelines` procedure's steps 0–9, starting with the step-0 grep over each file, and all six better-interface domains. A smaller hand-picked pass replaces none of them, whatever the change's size. A skill that can't be loaded or read the way `ui-lens.md` describes is the only reason a lens is missing, and the report names it as not reviewed.

Since this review is of the working tree, an app already serving it may be rendered to check states and contrast; don't start or switch a dev server for the review. A rendered check with no such app is listed as not verified.

## 4. Check correctness

Read the touched files whole, and their callers and callees, with pr-review's Phase 2 in mind: twin implementations, drift-by-duplication, load-bearing comments, tests that would pass without the change. New or edited comments follow `evergreen-comments`.

Classify every finding, from the UI lens and from this pass alike, with pr-review's Phase 3 classes, read for a local change: **introduced** (written by this change; fix it here), **pre-existing, now load-bearing**, or **follow-up**. Mark each blocking or non-blocking.

## 5. Report in the terminal

- **Scope**: the base, the file count, committed vs. uncommitted, and the lenses that ran, naming any that didn't.
- **Bottom line**: one sentence on whether the change is ready to push.
- **Findings**, ranked, each with its class, blocking or not, `path:line`, and the exact fix. Contrast findings give the measured ratio.
- **Step-0 hits left as they are**, each with its reason.
- **Not verified**: the checks that needed a render no app could give.

Then ask which findings to fix: all, some, or none. Stop there.

## 6. Fix, only when asked

Apply exactly the findings the user picked, and leave the changes unstaged and uncommitted. Run `pnpm lint` in each touched package, and `glint` when types could be affected. Report each finding as fixed, or skipped with the reason.
