// Matrix client utilities
export {
  createBotMatrixClient,
  type BotMatrixClientConfig,
} from './lib/matrix-client';

// Room locking for concurrency control
export { acquireRoomLock, releaseRoomLock } from './lib/room-lock';

// Graceful shutdown utilities
export {
  isShuttingDown,
  setShuttingDown,
  handleShutdown,
  createShutdownHandler,
  type ShutdownConfig,
} from './lib/shutdown';

// Signal handlers (SIGTERM, SIGINT)
export {
  setupSignalHandlers,
  type SignalHandlerConfig,
} from './lib/signal-handlers';

// Sliding sync setup
export { createSlidingSync, type SlidingSyncConfig } from './lib/sliding-sync';

// Membership utilities (auto-join on invite)
export { setupAutoJoinOnInvite, type AutoJoinConfig } from './lib/membership';
