---
name: review-branch
description: Reviews a git branch and provides a detailed analysis of the changes, including risks, performance issues, style concerns, and testing gaps.
allowed-tools: Read, Grep, Bash(git fetch origin, git rev-parse *, git diff *, git log *, git show *, git grep *), Bash(cd)
---

# Code Review Guide

Give me a thorough guided tour of the changes on the branch `$ARGUMENTS`. Read it from its ref, without checking it out, so the current checkout's branch and working tree stay as they are.

## Steps

1. Run `git fetch origin`, then pick the ref to review: `$ARGUMENTS` itself when `git rev-parse --verify --quiet $ARGUMENTS` resolves it (a local branch, or one already written as `origin/<name>`), otherwise `origin/$ARGUMENTS`. Call it `<ref>` below.
2. Run `git diff origin/main...<ref> --stat` to get an overview of changed files
3. Run `git log origin/main..<ref> --oneline` to understand the commit history
4. For each changed file, run `git diff origin/main...<ref> -- <file>` and analyze the diff; read the whole file with `git show <ref>:<file>` when the diff alone doesn't show enough
5. If the branch changes UI (templates, components, scoped styles), also run the UI lens in `.claude/skills/pr-review/references/ui-lens.md` and fold its findings into the per-file notes. Its greps run against `<ref>` with `git grep <pattern> <ref> -- <files>`, never against the working tree

## For each file, provide:

- **Summary**: What changed and the likely intent
- **Risks**: Bugs, security issues, race conditions, error handling gaps
- **Performance**: N+1 queries, unnecessary allocations, missing indexes
- **Style**: Naming, structure, consistency with surrounding code
- **Testing gaps**: What's untested or under-tested

## At the end, provide:

- An overall assessment (approve / request changes / needs discussion)
- A prioritized list of the top issues to raise in review
- Suggested review comments I can paste directly into the PR
- Suggested files for a human reviewer to pay attention to
