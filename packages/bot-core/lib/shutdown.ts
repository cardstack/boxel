import { logger } from '@cardstack/runtime-common';

let log = logger('bot-core:shutdown');

let _isShuttingDown = false;

/**
 * Returns whether the bot is currently in shutdown mode.
 * When true, the bot should not accept new work.
 */
export function isShuttingDown(): boolean {
  return _isShuttingDown;
}

/**
 * Sets the shutdown state. Typically called by signal handlers.
 */
export function setShuttingDown(value: boolean): void {
  _isShuttingDown = value;
}

export interface ShutdownConfig {
  /** Map of active work items to wait for before shutdown */
  activeWork: Map<string, unknown>;
  /** Maximum time to wait for active work in milliseconds (default: 10 minutes) */
  maxWaitTimeMs?: number;
  /** Label for the active work in logs (default: 'active work') */
  workLabel?: string;
}

/**
 * Creates a shutdown handler that waits for active work to complete.
 *
 * @example
 * ```ts
 * const activeGenerations = new Map();
 * const handleShutdown = createShutdownHandler({
 *   activeWork: activeGenerations,
 *   workLabel: 'active generations',
 * });
 *
 * // In signal handler:
 * await handleShutdown();
 * ```
 */
export function createShutdownHandler(config: ShutdownConfig) {
  const {
    activeWork,
    maxWaitTimeMs = 10 * 60 * 1000, // 10 minutes
    workLabel = 'active work',
  } = config;

  let waitPromise: Promise<void> | undefined;

  async function waitForActiveWork(): Promise<void> {
    let waitTime = 0;

    while (activeWork.size > 0) {
      if (waitTime === 0) {
        log.info(
          `Waiting for ${workLabel} to finish (count: ${activeWork.size})...`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      waitTime += 1000;

      if (waitTime > maxWaitTimeMs) {
        log.error(
          `Max wait time reached for ${workLabel} (${maxWaitTimeMs / 60000} minutes), exiting... (remaining: ${activeWork.size})`,
        );
        process.exit(1);
      }
    }
  }

  return async function handleShutdown(): Promise<void> {
    if (waitPromise) {
      return waitPromise;
    }

    _isShuttingDown = true;
    log.info('Shutting down...');

    waitPromise = waitForActiveWork();
    await waitPromise;
    waitPromise = undefined;
  };
}

// Simple shutdown handler for bots without active work tracking
let simpleWaitPromise: Promise<void> | undefined;

/**
 * Simple shutdown handler that just sets the shutdown flag.
 * Use createShutdownHandler() for more complex scenarios with active work tracking.
 */
export async function handleShutdown(): Promise<void> {
  if (simpleWaitPromise) {
    return simpleWaitPromise;
  }

  _isShuttingDown = true;
  log.info('Shutting down...');

  simpleWaitPromise = Promise.resolve();
  await simpleWaitPromise;
  simpleWaitPromise = undefined;
}
