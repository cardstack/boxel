import type { Command } from 'commander';
import { registerDeleteCommand } from './delete.ts';
import { registerListCommand } from './list.ts';
import { registerLintCommand } from './lint.ts';
import { registerReadCommand } from './read.ts';
import { registerTouchCommand } from './touch.ts';
import { registerWriteCommand } from './write.ts';

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
