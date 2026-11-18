import type { Command } from 'commander';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_GREEN, RESET } from '../../lib/colors.ts';
import { readKeyValue } from '../../lib/key-value.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { operatorRequest } from '../../lib/seed-auth.ts';
import {
  checkChangeSources,
  readNote,
  type SystemKeysOptions,
} from './keys.ts';

// `boxel realm-server secrets`: the realm server's platform secrets, the
// secrets the platform keeps and only reads, such as the secret that verifies
// a vendor's signed webhook. Authorized with the realm secret seed. A value is
// typed at a masked prompt or read from stdin or a file, never taken as an
// argument, and is write-only once set: the server never answers with one,
// and no command shows one, whole or in part, the masked prompt included.
// `list` and `show` give a secret's name, the data key its value is sealed
// under, and the note of whoever last set it and when. An operator who needs
// a different value sets it again.

export interface PlatformSecret {
  name: string;
  keyId: string;
  note: string;
  setAt: string;
}

async function operatorFetch(
  options: SystemKeysOptions,
  path: string,
  method: 'GET' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<any> {
  let { url, response } = await operatorRequest(
    options,
    'platform-secrets',
    path,
    method,
    body,
  );
  if (!response.ok) {
    let text = await response.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      let errors = JSON.parse(text)?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        message = errors.join('; ');
      }
    } catch {
      // Not JSON; report the text as it is.
    }
    throw new Error(
      `${method} ${url} answered HTTP ${response.status}: ${message}`,
    );
  }
  return response.json();
}

function secretPath(name: string): string {
  return `_platform-secrets/${encodeURIComponent(name)}`;
}

export async function listPlatformSecrets(
  options: SystemKeysOptions,
): Promise<PlatformSecret[]> {
  return (await operatorFetch(options, '_platform-secrets', 'GET')).secrets;
}

export async function showPlatformSecret(
  options: SystemKeysOptions,
  name: string,
): Promise<PlatformSecret> {
  return (await operatorFetch(options, secretPath(name), 'GET')).secret;
}

export async function setPlatformSecret(
  options: SystemKeysOptions,
  name: string,
  change: { value: string; note: string },
): Promise<PlatformSecret> {
  return (await operatorFetch(options, secretPath(name), 'PUT', change)).secret;
}

export async function deletePlatformSecret(
  options: SystemKeysOptions,
  name: string,
  change: { note: string },
): Promise<PlatformSecret> {
  return (await operatorFetch(options, secretPath(name), 'DELETE', change))
    .deleted;
}

export function printSecret(secret: PlatformSecret): void {
  console.log(secret.name);
  console.log(`  value: sealed under data key ${secret.keyId}`);
  console.log(`  last set: ${secret.setAt}: ${secret.note}`);
}

export interface SecretsCliOptions {
  realmServer: string;
  name?: string;
  stdin?: boolean;
  keyFile?: string;
  note?: string;
  json?: boolean;
}

async function seedOptions(
  options: SecretsCliOptions,
): Promise<SystemKeysOptions> {
  let realmSecretSeed = await resolveRealmSecretSeed(true);
  if (!realmSecretSeed) {
    throw new Error('A realm secret seed is required');
  }
  return { realmServerUrl: options.realmServer, realmSecretSeed };
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

function output(json: boolean | undefined, value: unknown, print: () => void) {
  if (json) {
    cliLog.output(JSON.stringify(value, null, 2));
  } else {
    print();
  }
}

const SECRET_NOUN = 'secret value';

/**
 * The secret's value for `set`, from `--key-file`, `--stdin`, or a masked
 * prompt that reveals nothing of it after Enter: a platform secret is never
 * shown, not even in part.
 */
export async function readSecretValue(
  source: { stdin?: boolean; keyFile?: string },
  io: { input?: NodeJS.ReadStream; output?: NodeJS.WritableStream } = {},
): Promise<string> {
  return readKeyValue(source, { ...io, revealLast: 0, noun: SECRET_NOUN });
}

const NOTE_HELP =
  'The operator note recorded with the change: who made it and why (prompted for when omitted). A name in it is recorded as given, not verified';

export function registerSecretsCommand(realmServer: Command): void {
  let secrets = realmServer
    .command('secrets')
    .description(
      "Manage the realm server's platform secrets (secrets the platform keeps and only reads, such as a webhook signing secret). A value is write-only: no command shows one",
    );

  secrets
    .command('list')
    .description(
      'List the platform secrets: name, data key, and who last set each and when',
    )
    .requiredOption('--realm-server <url>', 'The realm server to ask')
    .option('--json', 'Output JSON')
    .action(async (options: SecretsCliOptions) =>
      run(async () => {
        let list = await listPlatformSecrets(await seedOptions(options));
        output(options.json, list, () => {
          if (list.length === 0) {
            console.log('No platform secrets.');
          }
          list.forEach(printSecret);
        });
      }),
    );

  secrets
    .command('show')
    .description(
      'Show one platform secret: its name, data key, and who last set it and when',
    )
    .requiredOption('--realm-server <url>', 'The realm server to ask')
    .requiredOption('--name <name>', 'The secret, by its name')
    .option('--json', 'Output JSON')
    .action(async (options: SecretsCliOptions) =>
      run(async () => {
        let secret = await showPlatformSecret(
          await seedOptions(options),
          options.name!,
        );
        output(options.json, secret, () => printSecret(secret));
      }),
    );

  secrets
    .command('set')
    .description(
      'Set a platform secret, adding it or replacing its value. The value is typed at a masked prompt, or read with --stdin or --key-file',
    )
    .requiredOption('--realm-server <url>', 'The realm server to change')
    .requiredOption(
      '--name <name>',
      'The secret, by its name: lower-case letters, digits and dashes (such as openrouter-batch-webhook-signing)',
    )
    .option('--stdin', 'Read the value from stdin')
    .option('--key-file <path>', 'Read the value from a file')
    .option('--note <text>', NOTE_HELP)
    .option('--json', 'Output JSON')
    .action(async (options: SecretsCliOptions) =>
      run(async () => {
        checkChangeSources(options, { value: true, noun: SECRET_NOUN });
        let seed = await seedOptions(options);
        let value = await readSecretValue(options);
        let note = await readNote(options.note, {
          stdinUsed: Boolean(options.stdin),
        });
        let secret = await setPlatformSecret(seed, options.name!, {
          value,
          note,
        });
        output(options.json, secret, () => {
          console.log(`${FG_GREEN}Set the platform secret.${RESET}`);
          printSecret(secret);
        });
      }),
    );

  secrets
    .command('delete')
    .description(
      'Delete a platform secret; server code that reads it finds none from then on',
    )
    .requiredOption('--realm-server <url>', 'The realm server to change')
    .requiredOption('--name <name>', 'The secret, by its name')
    .option('--note <text>', NOTE_HELP)
    .option('--json', 'Output JSON')
    .action(async (options: SecretsCliOptions) =>
      run(async () => {
        checkChangeSources(options, { value: false });
        let seed = await seedOptions(options);
        let note = await readNote(options.note, { stdinUsed: false });
        let secret = await deletePlatformSecret(seed, options.name!, { note });
        output(options.json, secret, () => {
          console.log(
            `${FG_GREEN}Deleted the platform secret ${secret.name}.${RESET}`,
          );
        });
      }),
    );
}
