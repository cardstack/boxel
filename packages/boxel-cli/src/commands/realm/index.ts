import type { Command } from 'commander';
import { registerCreateCommand } from './create';
import { registerPullCommand } from './pull';
import { registerPushCommand } from './push';
import { registerSyncCommand } from './sync';
import { registerWaitForReadyCommand } from './wait-for-ready';

export function registerRealmCommand(program: Command): void {
  let realm = program
    .command('realm')
    .description('Manage realms on the realm server');

  registerCreateCommand(realm);
  registerPullCommand(realm);
  registerPushCommand(realm);
  registerSyncCommand(realm);
  registerWaitForReadyCommand(realm);
}
