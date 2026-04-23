import type { Command } from 'commander';
import { registerDeleteCommand } from './delete';

export function registerFileCommand(program: Command): void {
  let file = program.command('file').description('Manage files in a realm');

  registerDeleteCommand(file);
}
