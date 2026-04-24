import type { Command } from 'commander';
import { registerDeleteCommand } from './delete';
import { registerLintCommand } from './lint';
import { registerWriteCommand } from './write';

export function registerFileCommand(program: Command): void {
  let file = program
    .command('file')
    .description('Read, write, search, and manage files in a realm');

  registerDeleteCommand(file);
  registerLintCommand(file);
  registerWriteCommand(file);
}
