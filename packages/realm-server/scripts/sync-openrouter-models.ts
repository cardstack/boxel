import '../instrument';
import '../setup-logger'; // This should be first
import {
  logger,
  systemInitiatedPriority,
  type RunCommandResponse,
} from '@cardstack/runtime-common';
import type { RunCommandArgs } from '@cardstack/runtime-common/tasks/run-command';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import * as Sentry from '@sentry/node';

const log = logger('sync-openrouter-models');

const COMMAND_SPECIFIER =
  '@cardstack/boxel-host/commands/sync-openrouter-models/default';
const REALM_USERNAME = 'openrouter_realm';
const SYNC_JOB_TIMEOUT_SEC = 5 * 60; // 5 minutes for full model sync

export async function enqueueSyncOpenRouterModels({
  realmURL,
  priority = systemInitiatedPriority,
  migrateDB,
}: {
  realmURL: string;
  priority?: number;
  migrateDB?: boolean;
}) {
  let dbAdapter = new PgAdapter({ autoMigrate: migrateDB || undefined });
  let queue = new PgQueuePublisher(dbAdapter);

  let args: RunCommandArgs = {
    realmURL,
    realmUsername: REALM_USERNAME,
    runAs: REALM_USERNAME,
    command: COMMAND_SPECIFIER,
    commandInput: { realmUrl: realmURL },
  };

  try {
    await queue.publish<RunCommandResponse>({
      jobType: 'run-command',
      concurrencyGroup: `command:${realmURL}`,
      timeout: SYNC_JOB_TIMEOUT_SEC,
      priority,
      args,
    });
    log.info(`enqueued sync-openrouter-models job for realm ${realmURL}`);
  } catch (error) {
    Sentry.captureException(error);
    log.error('failed to enqueue sync-openrouter-models job', error);
    throw error;
  } finally {
    await queue.destroy();
    await dbAdapter.close();
  }
}
