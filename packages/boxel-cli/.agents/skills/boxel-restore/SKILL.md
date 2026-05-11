---
name: boxel-restore
description: Use when restoring a Boxel workspace to a previous checkpoint and syncing deletions back to the server safely, including stopping watch first and running `boxel sync . --prefer-local` after restore.
---

> **Factory agent note:** This skill is for human Claude Code sessions only. The factory agent's tool registry does not include boxel-cli tools — all realm I/O uses `write_file`, `read_file`, and `search_realm` tools via the realm HTTP API.

# Boxel Restore

Restore workspace to a previous checkpoint and sync deletions to server.

## Workflow

1. **Stop watch if running** - Prevents re-pulling deleted files
2. **Show history** - Display recent checkpoints with numbers
3. **Confirm target** - Ask user which checkpoint (or accept from command)
4. **Restore locally** - Run `boxel history . -r <target>`
5. **Sync to server** - Run `boxel sync . --prefer-local` to push deletions
6. **Restart watch** - Optionally restart watch if it was running

## Usage

```
Use the `boxel-restore` skill interactively
Restore checkpoint `3`
Restore checkpoint `abc123`
```

## Commands Used

```bash
# Stop any running watch first
# (check /tasks and stop if needed)

# View history
boxel history .

# Restore to checkpoint (auto-confirm)
echo "y" | boxel history . -r <target>

# ESSENTIAL: Push deletions to server
boxel sync . --prefer-local

# Optionally restart watch
boxel watch . -i <interval> -d <debounce>
```

## Response Format

1. Show the checkpoint being restored to (hash, message, date, source)
2. List files that will be deleted (if any new files since checkpoint)
3. Execute restore
4. Execute sync with --prefer-local
5. Confirm completion

## Critical Notes

- **Always stop watch before restoring** - Otherwise it re-pulls deleted files
- **Always use --prefer-local after restore** - This syncs deletions to server
- After restore, workspace matches checkpoint exactly (files added later are gone)

## Example Output

```
Restoring to checkpoint #3: abc1234
  Message: Pull: Update knicks-vip-ticket.gts
  Source: SERVER (external change)
  Date: 5 minutes ago

Files that will be deleted:
  - KnicksVipTicket/knicks-vs-magic.json
  - KnicksVipTicket/knicks-vs-thunder.json

Restoring... ✓
Syncing deletions to server... ✓

Restore complete. Server now matches checkpoint #3.
```
