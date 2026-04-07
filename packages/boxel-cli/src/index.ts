import { Command } from 'commander';

const program = new Command();

program
  .name('boxel')
  .description('CLI tools for Boxel workspace management')
  .version('0.0.1');

program.parse();
