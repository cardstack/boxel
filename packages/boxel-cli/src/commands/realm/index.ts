import type { Command } from 'commander';
import { registerCancelIndexingCommand } from './cancel-indexing.ts';
import { registerCreateCommand } from './create.ts';
import { registerHistoryCommand } from './history.ts';
import { registerIndexingErrorsCommand } from './indexing-errors.ts';
import { registerIngestCardCommand } from './ingest-card.ts';
import { registerListCommand } from './list.ts';
import { registerMilestoneCommand } from './milestone.ts';
import { registerPublishCommand } from './publish.ts';
import { registerPullCommand } from './pull.ts';
import { registerPushCommand } from './push.ts';
import { registerRemoveCommand } from './remove.ts';
import { registerStatusCommand } from './status.ts';
import { registerSyncCommand } from './sync.ts';
import { registerUnpublishCommand } from './unpublish.ts';
import { registerWaitForReadyCommand } from './wait-for-ready.ts';
import { registerWatchCommand } from './watch/index.ts';

export function registerRealmCommand(program: Command): void {
  let realm = program
    .command('realm')
    .description('Manage realms on the realm server');

  registerCancelIndexingCommand(realm);
  registerCreateCommand(realm);
  registerHistoryCommand(realm);
  registerIndexingErrorsCommand(realm);
  registerIngestCardCommand(realm);
  registerListCommand(realm);
  registerMilestoneCommand(realm);
  registerPublishCommand(realm);
  registerPullCommand(realm);
  registerPushCommand(realm);
  registerRemoveCommand(realm);
  const sync = registerSyncCommand(realm);
  registerStatusCommand(sync);
  registerUnpublishCommand(realm);
  registerWaitForReadyCommand(realm);
  registerWatchCommand(realm);
}
