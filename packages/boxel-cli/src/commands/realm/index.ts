import type { Command } from 'commander';
import { registerCancelIndexingCommand } from './cancel-indexing';
import { registerCreateCommand } from './create';
import { registerHistoryCommand } from './history';
import { registerIndexingStatusCommand } from './indexing-status';
import { registerListCommand } from './list';
import { registerMilestoneCommand } from './milestone';
import { registerPublishCommand } from './publish';
import { registerPullCommand } from './pull';
import { registerPushCommand } from './push';
import { registerRemoveCommand } from './remove';
import { registerStatusCommand } from './status';
import { registerSyncCommand } from './sync';
import { registerUnpublishCommand } from './unpublish';
import { registerWaitForReadyCommand } from './wait-for-ready';
import { registerWatchCommand } from './watch';

export function registerRealmCommand(program: Command): void {
  let realm = program
    .command('realm')
    .description('Manage realms on the realm server');

  registerCancelIndexingCommand(realm);
  registerCreateCommand(realm);
  registerHistoryCommand(realm);
  registerIndexingStatusCommand(realm);
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
