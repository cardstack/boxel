---
name: review-branch
description: Reviews a git branch and provides a detailed analysis of the changes, including risks, performance issues, style concerns, and testing gaps.
allowed-tools: Read, Grep, Bash(git fetch origin, git checkout *, git diff *, git log *), Bash(cd)
---

# Code Review Guide

Check out the branch `$ARGUMENTS` and give me a thorough guided tour of the changes.

## Steps

1. Run `git fetch origin` then `git checkout $ARGUMENTS`
2. Run `git diff main...$ARGUMENTS --stat` to get an overview of changed files
3. Run `git log main...$ARGUMENTS --oneline` to understand the commit history
4. For each changed file, run `git diff main...$ARGUMENTS -- <file>` and analyze the diff

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
