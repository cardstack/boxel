---
name: boxel-sync
description: Use when deciding how to sync a Boxel workspace after local edits, server changes, or a restore, including choosing between interactive sync, `--prefer-local`, `--prefer-remote`, or `--prefer-newest`.
---

> **Factory agent note:** This skill is for human Claude Code sessions only. The factory agent's tool registry does not include boxel-cli tools — all realm I/O uses `write_file`, `read_file`, and `search_realm` tools via the realm HTTP API.

# Boxel Sync

Smart bidirectional sync with context-aware conflict resolution.

## Context Detection

Analyze the situation to choose the right sync strategy:

### After Local Edits

When Claude has been editing files locally:

- Use `--prefer-local` to push changes
- Creates checkpoint for the push

### After Server Activity

When watch detected server changes or user mentions UI edits:

- Use `--prefer-remote` or default (interactive)
- Pull changes first

### After Restore

When a restore was just performed:

- Use `--prefer-local` to sync deletions to server
- Essential for completing the restore workflow

### Conflict Detected

When both sides have changes:

- Show status first
- Ask user preference or use `--prefer-newest`

## Commands

```bash
# Check status first
boxel status .

# Standard sync (interactive conflicts)
boxel sync .

# Push local changes
boxel sync . --prefer-local

# Pull remote changes
boxel sync . --prefer-remote

# Auto-resolve by timestamp
boxel sync . --prefer-newest

# Include deletions
boxel sync . --delete

# Preview only
boxel sync . --dry-run
```

## Response Format

1. Brief status check (what changed where)
2. Chosen strategy and why
3. Execute sync
4. Report results (files pushed/pulled/deleted)

## Example Output

```
Checking status...
  Local: 2 files modified
  Remote: No changes

Using --prefer-local since you have local edits.

Syncing...
  Pushed: card-definition.gts, instance.json
  Checkpoint: abc1234 [MAJOR] Push: 2 files

Sync complete!
```
