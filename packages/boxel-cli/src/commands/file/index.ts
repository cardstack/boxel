import type { Command } from 'commander';
import { registerDeleteCommand } from './delete';
import { registerListCommand } from './list';
import { registerLintCommand } from './lint';
import { registerReadCommand } from './read';
import { registerTouchCommand } from './touch';
import { registerWriteCommand } from './write';

export function registerFileCommand(program: Command): void {
  let file = program
    .command('file')
    .description('Read, write, and manage files in a realm');

  registerDeleteCommand(file);
  registerListCommand(file);
  registerLintCommand(file);
  registerReadCommand(file);
  registerTouchCommand(file);
  registerWriteCommand(file);
}
