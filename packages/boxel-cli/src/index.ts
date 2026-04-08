import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
);

const program = new Command();

program
  .name('boxel')
  .description('CLI tools for Boxel workspace management')
  .version(pkg.version);

program.parse();
