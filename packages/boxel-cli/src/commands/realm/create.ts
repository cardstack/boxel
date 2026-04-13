import type { Command } from 'commander';
import { createRealm, RealmAlreadyExistsError } from '../../lib/create-realm';
import { FG_GREEN, FG_CYAN, RESET } from '../../lib/colors';

export function registerCreateCommand(realm: Command): void {
  realm
    .command('create')
    .description('Create a new realm on the realm server')
    .argument('<realm-name>', 'realm name (lowercase, numbers, hyphens only)')
    .argument('<display-name>', 'display name for the realm')
    .option('--background <url>', 'background image URL')
    .option('--icon <url>', 'icon image URL')
    .action(
      async (
        realmName: string,
        displayName: string,
        options: { background?: string; icon?: string },
      ) => {
        try {
          let result = await createRealm({
            realmName,
            displayName,
            background: options.background,
            icon: options.icon,
          });
          console.log(
            `${FG_GREEN}Realm created:${RESET} ${FG_CYAN}${result.url}${RESET}`,
          );
        } catch (e: unknown) {
          if (e instanceof RealmAlreadyExistsError) {
            console.error(`Error: ${e.message}`);
          } else {
            console.error(
              `Error: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          process.exit(1);
        }
      },
    );
}
