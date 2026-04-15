import type { Command } from 'commander';
import { registerCreateCommand } from './create';
import { registerPullCommand } from './pull';

export function registerRealmCommand(program: Command): void {
  let realm = program
    .command('realm')
    .description('Manage realms on the realm server');

  registerCreateCommand(realm);
  registerPullCommand(realm);
}
