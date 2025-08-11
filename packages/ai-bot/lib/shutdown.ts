import { logger } from '@cardstack/runtime-common';

let log = logger('ai-bot:shutdown');

let _isShuttingDown = false;

export function isShuttingDown(): boolean {
  return _isShuttingDown;
}

export function setShuttingDown(value: boolean): void {
  _isShuttingDown = value;
}
let activeGenerations: Map<string, any> = new Map();

export function setActiveGenerations(generations: Map<string, any>) {
  activeGenerations = generations;
}

export async function waitForActiveGenerations(): Promise<void> {
  let minutes = 10;
  const maxWaitTime = minutes * 60 * 1000;
  let waitTime = 0;

  while (activeGenerations.size > 0) {
    if (waitTime === 0) {
      log.info(
        `Waiting for active generations to finish (count: ${activeGenerations.size})...`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    waitTime += 1000;

    if (waitTime > maxWaitTime) {
      log.error(
        `Max wait time reached for waiting for active generations to finish (${minutes} minutes), exiting... (active generations: ${activeGenerations.size})`,
      );
      process.exit(1);
    }
  }
}

let waitForActiveGenerationsPromise: Promise<void> | undefined;

export async function handleShutdown(): Promise<void> {
  if (waitForActiveGenerationsPromise) {
    return waitForActiveGenerationsPromise;
  }

  _isShuttingDown = true;

  log.info('Shutting down...');

  waitForActiveGenerationsPromise = waitForActiveGenerations();
  await waitForActiveGenerationsPromise;
  waitForActiveGenerationsPromise = undefined;
}
