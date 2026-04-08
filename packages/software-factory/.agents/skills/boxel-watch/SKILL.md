---
name: boxel-watch
description: Use when starting or choosing settings for `boxel watch` to monitor remote Boxel changes, including active-development, quick-feedback, and background-monitoring intervals.
---

> **Factory agent note:** This skill is for human Claude Code sessions only. The factory agent's tool registry does not include boxel-cli tools — all realm I/O uses `write_file`, `read_file`, and `search_realm` tools via the realm HTTP API.

# Boxel Watch

Start `boxel watch` with intelligent interval settings based on context.

## Context Detection

Analyze the conversation and recent activity to determine the appropriate watch settings:

### Active Development Mode (5s interval, 3s debounce)

Use when:

- User is actively editing .gts or .json files
- User mentions "editing", "working on", "changing", "updating"
- Recent file writes or edits in the workspace
- User asks to "watch while I work"

### Monitoring Mode (30s interval, 10s debounce)

Use when:

- User wants to "keep an eye on" changes
- User is doing research, reading, or planning
- No recent edits to workspace files
- User says "background", "monitor", or "check occasionally"

### Quick Feedback Mode (10s interval, 5s debounce)

Use when:

- User is testing changes in Boxel UI
- User mentions "testing", "trying", "see if it works"
- Balanced between responsiveness and efficiency

## Execution

1. Determine the workspace directory (default: current synced workspace)
2. Determine the mode based on context
3. Explain the chosen settings briefly
4. Start watch in background with appropriate flags
5. Inform user how to stop (Ctrl+C or task stop)

## Commands

```bash
# Active development
boxel watch . -i 5 -d 3

# Monitoring
boxel watch . -i 30 -d 10

# Quick feedback
boxel watch . -i 10 -d 5

# Quiet mode (any interval)
boxel watch . -i <interval> -d <debounce> -q
```

## Response Format

When invoked, respond with:

1. Detected mode and reasoning (1 sentence)
2. The watch command being run
3. How to stop or adjust

Example:
"Starting watch in **active development mode** (5s interval) since you're editing card files. Run in background - use `/tasks` to check status or Ctrl+C to stop."
