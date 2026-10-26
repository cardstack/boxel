import type { Command } from 'commander';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_GREEN, RESET } from '../../lib/colors.ts';
import { readKeyValue } from '../../lib/key-value.ts';
import { prompt, resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { operatorRequest } from '../../lib/seed-auth.ts';

export { readKeyValue, type KeyValueSource } from '../../lib/key-value.ts';

// `boxel realm-server keys`: the realm server's system keys, the platform's
// own vendor keys that `_request-forward` attaches. Authorized with the realm
// secret seed. A value is typed at a masked prompt or read from stdin or a
// file, never taken as an argument, and no command prints one: the server
// never answers with a value. Every change carries an operator note, which
// the server records in the key's history next to what it observed itself: the
// caller's address and when the operator token was signed. A name in a note is
// as the operator typed it; nothing verifies it.

export type SystemKeyAuthMethod = 'header' | 'url-parameter';
export type SystemKeyCreditStrategy = 'openrouter' | 'none';

export interface SystemKey {
  id: string;
  destination: string;
  authMethod: string;
  paramName: string | null;
  creditStrategy: string;
  supportsStreaming: boolean;
  hasValue: boolean;
  keyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemKeyChange {
  action: 'add' | 'replace' | 'delete';
  destination: string;
  note: string;
  keyId: string | null;
  changedAt: string;
  clientAddress: string | null;
  tokenIssuedAt: string | null;
}

export interface SystemKeysOptions {
  realmServerUrl: string;
  realmSecretSeed: string;
  fetch?: typeof globalThis.fetch;
}

export interface NewSystemKey {
  destination: string;
  authMethod?: SystemKeyAuthMethod;
  paramName?: string;
  creditStrategy: SystemKeyCreditStrategy;
  supportsStreaming?: boolean;
  value: string;
  note: string;
}

async function operatorFetch(
  options: SystemKeysOptions,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<any> {
  let { url, response } = await operatorRequest(
    options,
    'system-keys',
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

export async function listSystemKeys(
  options: SystemKeysOptions,
): Promise<SystemKey[]> {
  return (await operatorFetch(options, '_system-keys', 'GET')).keys;
}

export async function showSystemKey(
  options: SystemKeysOptions,
  id: string,
): Promise<{ key: SystemKey; history: SystemKeyChange[] }> {
  return operatorFetch(
    options,
    `_system-keys/${encodeURIComponent(id)}`,
    'GET',
  );
}

export async function addSystemKey(
  options: SystemKeysOptions,
  key: NewSystemKey,
): Promise<SystemKey> {
  return (await operatorFetch(options, '_system-keys', 'POST', key)).key;
}

export async function replaceSystemKey(
  options: SystemKeysOptions,
  id: string,
  change: { value: string; note: string },
): Promise<SystemKey> {
  return (
    await operatorFetch(
      options,
      `_system-keys/${encodeURIComponent(id)}`,
      'PATCH',
      change,
    )
  ).key;
}

export async function deleteSystemKey(
  options: SystemKeysOptions,
  id: string,
  change: { note: string },
): Promise<SystemKey> {
  return (
    await operatorFetch(
      options,
      `_system-keys/${encodeURIComponent(id)}`,
      'DELETE',
      change,
    )
  ).deleted;
}

// The id of the key named by `--id`, or of the key for `--destination`,
// compared as the server stores destinations (as the URL parser spells them).
export async function resolveSystemKeyId(
  options: SystemKeysOptions,
  selector: { id?: string; destination?: string },
): Promise<string> {
  if (selector.id && selector.destination) {
    throw new Error('Name the key with --id or --destination, not both');
  }
  if (selector.id) {
    return selector.id;
  }
  if (!selector.destination) {
    throw new Error('Name the key with --id or --destination');
  }
  let destination: string;
  try {
    destination = new URL(selector.destination).href;
  } catch {
    throw new Error(`${selector.destination} is not a URL`);
  }
  let match = (await listSystemKeys(options)).find(
    (key) => key.destination === destination,
  );
  if (!match) {
    throw new Error(`No system key has the destination ${destination}`);
  }
  return match.id;
}

/**
 * The operator note for a change: `--note`, or a prompt when stdin is a
 * terminal that the value didn't come through.
 */
export async function readNote(
  note: string | undefined,
  { stdinUsed }: { stdinUsed: boolean },
): Promise<string> {
  if (note !== undefined) {
    if (!note.trim()) {
      throw new Error('The operator note is empty');
    }
    return note;
  }
  if (stdinUsed || !process.stdin.isTTY) {
    throw new Error(
      'Pass --note: the operator note, recorded in the key history, says who made the change and why. A name in it is recorded as given, not verified',
    );
  }
  let answer = await prompt(
    'Operator note (who and why; a name here is recorded as given, not verified): ',
  );
  if (!answer) {
    throw new Error('The operator note is empty');
  }
  return answer;
}

function printKey(key: SystemKey): void {
  console.log(`${key.destination}`);
  console.log(`  id: ${key.id}`);
  console.log(
    `  auth: ${key.authMethod}${key.paramName ? ` (${key.paramName})` : ''}`,
  );
  console.log(`  credit strategy: ${key.creditStrategy}`);
  console.log(`  streaming: ${key.supportsStreaming ? 'yes' : 'no'}`);
  console.log(
    `  value: ${key.hasValue ? (key.keyId ? `sealed under data key ${key.keyId}` : 'in plain text only, until the backfill seals it') : 'none'}`,
  );
  console.log(`  updated: ${key.updatedAt}`);
}

function printHistory(history: SystemKeyChange[]): void {
  if (history.length === 0) {
    console.log('  history: none recorded');
    return;
  }
  console.log('  history:');
  for (let change of history) {
    console.log(`    ${change.changedAt} ${change.action}: ${change.note}`);
    console.log(
      `      from ${change.clientAddress ?? 'an unknown address'}, token signed ${change.tokenIssuedAt ?? 'at an unknown time'}`,
    );
  }
}

interface KeysCliOptions {
  realmServer: string;
  id?: string;
  destination?: string;
  auth?: SystemKeyAuthMethod;
  paramName?: string;
  creditStrategy?: SystemKeyCreditStrategy;
  streaming?: boolean;
  stdin?: boolean;
  keyFile?: string;
  note?: string;
  json?: boolean;
}

async function seedOptions(
  options: KeysCliOptions,
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

const SELECT_HELP = {
  id: 'The key, by its id',
  destination: 'The key, by its destination URL',
};

function valueOptions(command: Command): Command {
  return command
    .option('--stdin', 'Read the key value from stdin')
    .option('--key-file <path>', 'Read the key value from a file')
    .option(
      '--note <text>',
      'The operator note recorded with the change: who made it and why (prompted for when omitted). A name in it is recorded as given, not verified',
    );
}

export function registerKeysCommand(realmServer: Command): void {
  let keys = realmServer
    .command('keys')
    .description(
      "Manage the realm server's system keys: the platform's own vendor keys that the proxy attaches. No command shows a value",
    );

  keys
    .command('list')
    .description('List the system keys, without their values')
    .requiredOption('--realm-server <url>', 'The realm server to ask')
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        let list = await listSystemKeys(await seedOptions(options));
        output(options.json, list, () => {
          if (list.length === 0) {
            console.log('No system keys.');
          }
          list.forEach(printKey);
        });
      }),
    );

  keys
    .command('show')
    .description(
      'Show one system key and its recent history, without its value',
    )
    .requiredOption('--realm-server <url>', 'The realm server to ask')
    .option('--id <id>', SELECT_HELP.id)
    .option('--destination <url>', SELECT_HELP.destination)
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        let seed = await seedOptions(options);
        let shown = await showSystemKey(
          seed,
          await resolveSystemKeyId(seed, options),
        );
        output(options.json, shown, () => {
          printKey(shown.key);
          printHistory(shown.history);
        });
      }),
    );

  valueOptions(
    keys
      .command('add')
      .description(
        'Add a system key for a destination that has none. The value is typed at a masked prompt, or read with --stdin or --key-file',
      )
      .requiredOption('--realm-server <url>', 'The realm server to change')
      .requiredOption(
        '--destination <url>',
        'The URL the key is sent to; requests under it get the key',
      )
      .requiredOption(
        '--credit-strategy <strategy>',
        'How calls are charged: openrouter or none',
      )
      .option(
        '--auth <method>',
        'Where the key goes: header or url-parameter',
        'header',
      )
      .option(
        '--param-name <name>',
        'The header (default Authorization) or URL parameter (default key) that carries the key. A header always carries it as a Bearer token',
      )
      .option('--streaming', 'The destination supports streamed responses'),
  )
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        if (!['openrouter', 'none'].includes(options.creditStrategy!)) {
          throw new Error('--credit-strategy must be openrouter or none');
        }
        if (!['header', 'url-parameter'].includes(options.auth!)) {
          throw new Error('--auth must be header or url-parameter');
        }
        let seed = await seedOptions(options);
        let value = await readKeyValue(options);
        let note = await readNote(options.note, {
          stdinUsed: Boolean(options.stdin),
        });
        let key = await addSystemKey(seed, {
          destination: options.destination!,
          authMethod: options.auth,
          paramName: options.paramName,
          creditStrategy: options.creditStrategy!,
          supportsStreaming: Boolean(options.streaming),
          value,
          note,
        });
        output(options.json, key, () => {
          console.log(`${FG_GREEN}Added the system key.${RESET}`);
          printKey(key);
        });
      }),
    );

  valueOptions(
    keys
      .command('replace')
      .description(
        "Replace a system key's value, keeping its destination and settings",
      )
      .requiredOption('--realm-server <url>', 'The realm server to change')
      .option('--id <id>', SELECT_HELP.id)
      .option('--destination <url>', SELECT_HELP.destination),
  )
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        let seed = await seedOptions(options);
        let id = await resolveSystemKeyId(seed, options);
        let value = await readKeyValue(options);
        let note = await readNote(options.note, {
          stdinUsed: Boolean(options.stdin),
        });
        let key = await replaceSystemKey(seed, id, { value, note });
        output(options.json, key, () => {
          console.log(`${FG_GREEN}Replaced the system key.${RESET}`);
          printKey(key);
        });
      }),
    );

  keys
    .command('delete')
    .description('Delete a system key; the proxy stops serving its destination')
    .requiredOption('--realm-server <url>', 'The realm server to change')
    .option('--id <id>', SELECT_HELP.id)
    .option('--destination <url>', SELECT_HELP.destination)
    .option(
      '--note <text>',
      'The operator note recorded with the change: who made it and why (prompted for when omitted). A name in it is recorded as given, not verified',
    )
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        let seed = await seedOptions(options);
        let id = await resolveSystemKeyId(seed, options);
        let note = await readNote(options.note, { stdinUsed: false });
        let key = await deleteSystemKey(seed, id, { note });
        output(options.json, key, () => {
          console.log(
            `${FG_GREEN}Deleted the system key for ${key.destination}.${RESET}`,
          );
        });
      }),
    );
}
