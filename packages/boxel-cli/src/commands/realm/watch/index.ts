import type { Command } from 'commander';
import { registerStartCommand } from './start.ts';
import { registerStopCommand } from './stop.ts';

export function registerWatchCommand(realm: Command): void {
  const watch = realm
    .command('watch')
    .description('Watch a Boxel realm; subcommands manage watch processes');

  registerStartCommand(watch);
  registerStopCommand(watch);
}
