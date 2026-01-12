# Submission Bot

A Matrix bot for handling PR submissions and related actions in Boxel.

## Overview

The Submission Bot is designed to be invited to Matrix rooms to handle submission workflows. Unlike the AI bot (which waits for user messages), the Submission Bot:

1. **Sends the first message** when invited to a room
2. **Reads submission context** from room state (set by the invite command)
3. **Executes server-side actions** like interacting with GitHub APIs

## Usage

### Inviting the Bot

Use the `InviteSubmissionBotCommand` from the host app:

```typescript
await new InviteSubmissionBotCommand(commandContext).execute({
  roomId: 'your-room-id',
  submissionTarget: 'https://github.com/org/repo/pull/123',
  type: 'pull-request',
  autoStart: true,
});
```

### Commands

Once in a room, users can interact with the bot using these commands:

- `submit pr <url>` - Submit a pull request for review
- `status` - Check current submission status
- `help` - Show help message

## Environment Variables

| Variable                        | Description                   | Default                 |
| ------------------------------- | ----------------------------- | ----------------------- |
| `MATRIX_URL`                    | Matrix homeserver URL         | `http://localhost:8008` |
| `BOXEL_SUBMISSION_BOT_PASSWORD` | Bot password                  | `pass`                  |
| `DISABLE_MATRIX_JS_LOGGING`     | Disable Matrix SDK debug logs | unset                   |

## Development

```bash
# Start the bot
pnpm start

# Start with development database
pnpm start:development
```

## Architecture

This bot uses `@cardstack/bot-core` for shared Matrix bot infrastructure:

- `createBotMatrixClient()` - Matrix authentication
- `setupAutoJoinOnInvite()` - Auto-join with callback for greeting
- `acquireRoomLock()` / `releaseRoomLock()` - Concurrency control
- `createShutdownHandler()` / `setupSignalHandlers()` - Graceful shutdown
- `createSlidingSync()` - Efficient room sync

## TODO

- [ ] Implement GitHub API integration
- [ ] Add PR validation logic
- [ ] Create/update cards based on PR content
- [ ] Add more command handlers
- [ ] Add tests
