import type { Command } from 'commander';
import { registerStartCommand } from './start';
import { registerStopCommand } from './stop';

export function registerWatchCommand(realm: Command): void {
  const watch = realm
    .command('watch')
    .description('Watch a Boxel realm; subcommands manage watch processes');

  registerStartCommand(watch);
  registerStopCommand(watch);
}
