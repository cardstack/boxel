import type { Command } from 'commander';
import { registerCardReadCommand } from './read';

export function registerCardCommand(program: Command): void {
  let card = program
    .command('card')
    .description('Read and manage card instances in a realm');

  registerCardReadCommand(card);
}
