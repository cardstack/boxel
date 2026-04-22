import type { Command } from 'commander';
import { registerCancelIndexingCommand } from './cancel-indexing';
import { registerCreateCommand } from './create';
import { registerPullCommand } from './pull';
import { registerPushCommand } from './push';
import { registerSyncCommand } from './sync';

export function registerRealmCommand(program: Command): void {
  let realm = program
    .command('realm')
    .description('Manage realms on the realm server');

  registerCancelIndexingCommand(realm);
  registerCreateCommand(realm);
  registerPullCommand(realm);
  registerPushCommand(realm);
  registerSyncCommand(realm);
}
