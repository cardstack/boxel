import type { Command } from 'commander';
import { registerDataKeysCommand } from './data-keys.ts';
import { registerKeysCommand } from './keys.ts';
import { registerRenderTokenCommand } from './render-token.ts';

// Operator commands for a realm server, authorized with its realm secret
// seed. The namespace stays out of the general help.
export function registerRealmServerCommand(program: Command): void {
  let realmServer = program
    .command('realm-server', { hidden: true })
    .description(
      'Operate a realm server with its realm secret seed (env: BOXEL_REALM_SECRET_SEED; names the paired Matrix server from MATRIX_SERVER_NAME)',
    );

  registerDataKeysCommand(realmServer);
  registerKeysCommand(realmServer);
  registerRenderTokenCommand(realmServer);
}
