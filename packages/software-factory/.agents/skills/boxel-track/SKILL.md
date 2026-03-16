---
name: boxel-track
description: Use when starting or explaining `boxel track` for local file watching, automatic checkpoints, or optional real-time push with `--push` during Boxel development.
---

# Boxel Track

Start `boxel track` to monitor local file changes and create checkpoints automatically.

## When to Use Track

Use **track** when you're editing files locally (in IDE, with AI agent, etc.) and want automatic backups:

- Working in VS Code, Cursor, or other IDE
- AI agent is editing files
- You want checkpoint history of your work

**Track vs Watch:**
| Command | Symbol | Direction | Purpose |
|---------|--------|-----------|---------|
| `track` | ⇆ | Local edits → Checkpoints | Backup your work as you edit |
| `watch` | ⇅ | Server → Local | Pull external changes from Boxel UI |

## Commands

```bash
# Start tracking (default: 3s debounce, 10s min interval)
boxel track .

# Track AND auto-push to server (real-time sync)
boxel track . --push

# Custom timing (5s debounce, 30s between checkpoints)
boxel track . -d 5 -i 30

# Quiet mode (only show checkpoints)
boxel track . -q

# Verbose mode (debug output)
boxel track . -v

# Stop all track/watch processes
boxel stop
```

## The Track → Sync Workflow

### Option 1: Manual Sync (Default)

Track creates local checkpoints only. Push to server when ready:

```bash
# 1. Track creates checkpoints as you edit
boxel track .

# 2. When ready to push to server, sync with --prefer-local
boxel sync . --prefer-local
```

This lets you:

- Work offline with local backups
- Batch multiple edits before pushing
- Review changes before they go live

### Option 2: Real-Time Sync (--push)

Auto-push changes to server as you edit:

```bash
# Track AND push changes automatically
boxel track . --push
```

Uses batch upload via `/_atomic` endpoint for efficient multi-file uploads. Definitions (.gts) are uploaded before instances (.json) to ensure proper indexing.

## Context Detection

When invoked, consider:

### Standard Development (3s debounce, 10s interval)

- Normal editing workflow
- Balanced between checkpoint frequency and overhead

### Fast Iteration (2s debounce, 5s interval)

- Rapid prototyping
- User says "track closely" or "capture everything"

### Background Tracking (5s debounce, 30s interval)

- Long editing sessions
- User says "just backup" or "light tracking"

## Response Format

When invoked:

1. Confirm workspace directory
2. Start track with appropriate settings
3. **Remind user about sync options**

Example (without --push):

```
Starting track in the current workspace (3s debounce, 10s interval).
Checkpoints will be created automatically as you save files.

Remember: Track creates LOCAL checkpoints only.
When ready to push changes to Boxel server:
  boxel sync . --prefer-local

Or restart with --push for real-time sync:
  boxel track . --push

Use Ctrl+C to stop tracking, or `boxel stop` from another terminal.
```

Example (with --push):

```
Starting track with auto-push (3s debounce, 10s interval).
Changes will be checkpointed AND pushed to server automatically.

Use Ctrl+C to stop, or `boxel stop` from another terminal.
```
