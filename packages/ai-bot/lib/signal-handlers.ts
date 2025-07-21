import { logger } from '@cardstack/runtime-common';
import { handleShutdown } from './shutdown';

let log = logger('ai-bot:signals');

let firstSigintTime = 0;
const SIGINT_DEBOUNCE_MS = 50; // Treat SIGINTs within 50ms as the same event

export function setupSignalHandlers(): void {
  // Handle SIGTERM (sent by ECS when it shuts down the instance)
  process.on('SIGTERM', async () => {
    await handleShutdown();
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
        'Gracefully shutting down... (Press Ctrl+C again to force exit)',
      );
      // Start graceful shutdown asynchronously but don't await here
      handleShutdown().then(() => process.exit(0));
    } else if (now - firstSigintTime > SIGINT_DEBOUNCE_MS) {
      // This is a genuine second Ctrl+C (after the debounce period)
      log.info('Exiting immediately...');
      process.exit(1);
    } else {
      // This is a duplicate/rapid SIGINT from the same Ctrl+C press, ignore it
      // (no logging for this case)
    }
  });
}
