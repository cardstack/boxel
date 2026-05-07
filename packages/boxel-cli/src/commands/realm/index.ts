import type { Command } from 'commander';
import { registerCancelIndexingCommand } from './cancel-indexing';
import { registerCreateCommand } from './create';
import { registerHistoryCommand } from './history';
import { registerListCommand } from './list';
import { registerPullCommand } from './pull';
import { registerPushCommand } from './push';
import { registerRemoveCommand } from './remove';
import { registerSyncCommand } from './sync';
import { registerWaitForReadyCommand } from './wait-for-ready';
import { registerWatchCommand } from './watch';

export function registerRealmCommand(program: Command): void {
  let realm = program
    .command('realm')
    .description('Manage realms on the realm server');

  registerCancelIndexingCommand(realm);
  registerCreateCommand(realm);
  registerHistoryCommand(realm);
  registerListCommand(realm);
  registerPullCommand(realm);
  registerPushCommand(realm);
  registerRemoveCommand(realm);
  registerSyncCommand(realm);
  registerWaitForReadyCommand(realm);
  registerWatchCommand(realm);
}
