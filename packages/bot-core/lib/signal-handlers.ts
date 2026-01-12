import { logger } from '@cardstack/runtime-common';

let log = logger('bot-core:signals');

export interface SignalHandlerConfig {
  /** Function to call when shutdown is triggered */
  onShutdown: () => Promise<void>;
  /** Bot name for logging (default: 'bot') */
  botName?: string;
}

let firstSigintTime = 0;
const SIGINT_DEBOUNCE_MS = 50; // Treat SIGINTs within 50ms as the same event

/**
 * Sets up signal handlers for graceful shutdown.
 *
 * Handles:
 * - SIGTERM: Graceful shutdown (e.g., from container orchestration)
 * - SIGINT: Ctrl+C from user. First press triggers graceful shutdown,
 *           second press forces immediate exit.
 *
 * @example
 * ```ts
 * const handleShutdown = createShutdownHandler({ activeWork: myActiveWork });
 * setupSignalHandlers({ onShutdown: handleShutdown, botName: 'ai-bot' });
 * ```
 */
export function setupSignalHandlers(config: SignalHandlerConfig): void {
  const { onShutdown, botName = 'bot' } = config;

  // Handle SIGTERM (sent by ECS when it shuts down the instance)
  process.on('SIGTERM', async () => {
    log.info(`[${botName}] Received SIGTERM, shutting down gracefully...`);
    await onShutdown();
    process.exit(0);
  });

  // Handle SIGINT (Ctrl+C from user)
  process.on('SIGINT', () => {
    const now = Date.now();

    // For some reason, SIGINT is being sent multiple times when Ctrl+C is pressed.
    // This is a workaround to ignore the duplicate SIGINTs.

    // If this is the very first SIGINT or enough time has passed since the last "real" SIGINT
    if (firstSigintTime === 0) {
      // First SIGINT ever
      firstSigintTime = now;
      log.info(
        `[${botName}] Gracefully shutting down... (Press Ctrl+C again to force exit)`,
      );
      // Start graceful shutdown asynchronously but don't await here
      onShutdown().then(() => process.exit(0));
    } else if (now - firstSigintTime > SIGINT_DEBOUNCE_MS) {
      // This is a genuine second Ctrl+C (after the debounce period)
      log.info(`[${botName}] Exiting immediately...`);
      process.exit(1);
    }
    // Duplicate/rapid SIGINT from the same Ctrl+C press - ignore it
  });
}
