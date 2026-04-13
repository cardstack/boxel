import type { Command } from 'commander';
import { registerCreateCommand } from './create';

export function registerRealmCommand(program: Command): void {
  let realm = program
    .command('realm')
    .description('Manage realms on the realm server');

  registerCreateCommand(realm);
}
