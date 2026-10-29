import type { Command } from 'commander';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_GREEN, RESET } from '../../lib/colors.ts';
import { readKeyValue } from '../../lib/key-value.ts';
import { prompt, resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { operatorRequest } from '../../lib/seed-auth.ts';

export { readKeyValue, type KeyValueSource } from '../../lib/key-value.ts';

// `boxel realm-server keys`: the realm server's system keys, the platform's
// own vendor keys that `_request-forward` attaches, and with
// `--kind oauth-client` its platform clients, the OAuth apps Boxel registered
// with a vendor that connect mode offers everyone. Authorized with the realm
// secret seed. A value is typed at a masked prompt or read from stdin or a
// file, never taken as an argument, and no command prints one: the server
// never answers with a value. Every change to a system key or a platform
// client carries an operator note, which the server records in its history
// next to what it observed itself: the caller's address and when the operator
// token was signed. A name in a note is as the operator typed it; nothing
// verifies it.

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

export type SystemKeyKind = 'system' | 'oauth-client';

export interface PlatformClient {
  id: string;
  name: string;
  label: string;
  clientId: string;
  grantType: string;
  authorizeURL: string | null;
  tokenURL: string;
  scopes: string;
  tokenAuth: string;
  apiHosts: string[];
  state: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformClientChange {
  action: 'add' | 'replace' | 'delete';
  name: string;
  clientId: string;
  note: string;
  keyId: string | null;
  changedAt: string;
  clientAddress: string | null;
  tokenIssuedAt: string | null;
}

export interface NewPlatformClient {
  name: string;
  label: string;
  secret: string;
  note: string;
  oauth: {
    clientId: string;
    authorizeUrl: string;
    tokenUrl: string;
    scopes?: string;
    tokenAuth?: 'client_secret_post' | 'client_secret_basic';
    apiHosts: string[];
  };
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

export async function listPlatformClients(
  options: SystemKeysOptions,
): Promise<PlatformClient[]> {
  return (await operatorFetch(options, '_platform-oauth-clients', 'GET'))
    .clients;
}

export async function showPlatformClient(
  options: SystemKeysOptions,
  name: string,
): Promise<{ client: PlatformClient; history: PlatformClientChange[] }> {
  return operatorFetch(
    options,
    `_platform-oauth-clients/${encodeURIComponent(name)}`,
    'GET',
  );
}

export async function addPlatformClient(
  options: SystemKeysOptions,
  client: NewPlatformClient,
): Promise<PlatformClient> {
  return (
    await operatorFetch(options, '_platform-oauth-clients', 'POST', client)
  ).client;
}

// Replacing the secret also clears a client its token endpoint refused.
export async function replacePlatformClientSecret(
  options: SystemKeysOptions,
  name: string,
  change: { secret: string; note: string },
): Promise<PlatformClient> {
  return (
    await operatorFetch(
      options,
      `_platform-oauth-clients/${encodeURIComponent(name)}`,
      'PATCH',
      change,
    )
  ).client;
}

export async function deletePlatformClient(
  options: SystemKeysOptions,
  name: string,
  change: { note: string },
): Promise<void> {
  await operatorFetch(
    options,
    `_platform-oauth-clients/${encodeURIComponent(name)}`,
    'DELETE',
    change,
  );
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
      'Pass --note: the operator note, recorded in the history, says who made the change and why. A name in it is recorded as given, not verified',
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

function printClient(client: PlatformClient): void {
  console.log(`${client.name}: ${client.label}`);
  console.log(`  id: ${client.id}`);
  console.log(`  client id: ${client.clientId}`);
  console.log(`  signs in at: ${client.authorizeURL}`);
  console.log(`  token endpoint: ${client.tokenURL} (${client.tokenAuth})`);
  console.log(`  scopes: ${client.scopes || 'none'}`);
  console.log(
    `  offered for: ${client.apiHosts.length > 0 ? client.apiHosts.join(', ') : 'no API host'}`,
  );
  console.log(
    `  state: ${client.state === 'broken' ? 'broken: its token endpoint refused the secret; replace it' : client.state}`,
  );
  console.log(`  updated: ${client.updatedAt}`);
}

function printHistory(
  history: (SystemKeyChange | PlatformClientChange)[],
): void {
  if (history.length === 0) {
    console.log('  history: none recorded');
    return;
  }
  console.log('  history:');
  for (let change of history) {
    // A platform client's history is kept by name, so an entry may be for an
    // earlier client deleted under that name: the vendor's client id tells
    // them apart.
    let client = 'clientId' in change ? ` (client id ${change.clientId})` : '';
    console.log(
      `    ${change.changedAt} ${change.action}${client}: ${change.note}`,
    );
    console.log(
      `      from ${change.clientAddress ?? 'an unknown address'}, token signed ${change.tokenIssuedAt ?? 'at an unknown time'}`,
    );
  }
}

export interface KeysCliOptions {
  realmServer: string;
  kind?: string;
  name?: string;
  label?: string;
  clientId?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string;
  tokenAuth?: string;
  apiHost?: string[];
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

function kindOf(options: KeysCliOptions): SystemKeyKind {
  let kind = options.kind ?? 'system';
  if (kind !== 'system' && kind !== 'oauth-client') {
    throw new Error('--kind must be system or oauth-client');
  }
  return kind;
}

// A platform client is named by `--name`; a system key by `--id` or
// `--destination`. Each refuses the other's selectors.
function clientName(options: KeysCliOptions): string {
  if (options.id || options.destination) {
    throw new Error(
      'Name a platform client with --name, not --id or --destination',
    );
  }
  if (!options.name) {
    throw new Error('Name the platform client with --name');
  }
  return options.name;
}

export function refuseClientOptions(options: KeysCliOptions): void {
  let clientOnly = (
    [
      ['name', '--name'],
      ['label', '--label'],
      ['clientId', '--client-id'],
      ['authorizeUrl', '--authorize-url'],
      ['tokenUrl', '--token-url'],
      ['scopes', '--scopes'],
      ['tokenAuth', '--token-auth'],
      ['apiHost', '--api-host'],
    ] as const
  ).filter(([option]) => options[option] !== undefined);
  if (clientOnly.length > 0) {
    throw new Error(
      `${clientOnly.map(([, flag]) => flag).join(', ')} ${clientOnly.length === 1 ? 'is' : 'are'} for a platform client: pass --kind oauth-client`,
    );
  }
}

const KIND_HELP =
  'system (the default): a system key; oauth-client: a platform client, an OAuth app Boxel registered with a vendor';

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const SELECT_HELP = {
  id: 'The key, by its id',
  destination: 'The key, by its destination URL',
  name: 'The platform client, by its name (with --kind oauth-client)',
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
      "Manage the realm server's system keys (the platform's own vendor keys that the proxy attaches) and, with --kind oauth-client, its platform clients. No command shows a value",
    );

  keys
    .command('list')
    .description('List the system keys or platform clients, without secrets')
    .requiredOption('--realm-server <url>', 'The realm server to ask')
    .option('--kind <kind>', KIND_HELP)
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        if (kindOf(options) === 'oauth-client') {
          let clients = await listPlatformClients(await seedOptions(options));
          output(options.json, clients, () => {
            if (clients.length === 0) {
              console.log('No platform clients.');
            }
            clients.forEach(printClient);
          });
          return;
        }
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
      'Show one system key or platform client and its recent history, without secrets',
    )
    .requiredOption('--realm-server <url>', 'The realm server to ask')
    .option('--kind <kind>', KIND_HELP)
    .option('--id <id>', SELECT_HELP.id)
    .option('--destination <url>', SELECT_HELP.destination)
    .option('--name <name>', SELECT_HELP.name)
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        if (kindOf(options) === 'oauth-client') {
          let name = clientName(options);
          let shown = await showPlatformClient(
            await seedOptions(options),
            name,
          );
          output(options.json, shown, () => {
            printClient(shown.client);
            printHistory(shown.history);
          });
          return;
        }
        refuseClientOptions(options);
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
        "Add a system key for a destination that has none, or with --kind oauth-client a platform client. The value (a platform client's client secret) is typed at a masked prompt, or read with --stdin or --key-file",
      )
      .requiredOption('--realm-server <url>', 'The realm server to change')
      .option('--kind <kind>', KIND_HELP)
      .option(
        '--destination <url>',
        'The URL the key is sent to; requests under it get the key',
      )
      .option(
        '--credit-strategy <strategy>',
        'How calls are charged: openrouter or none',
      )
      .option(
        '--auth <method>',
        'Where the key goes: header (the default) or url-parameter',
      )
      .option(
        '--param-name <name>',
        'The header (default Authorization) or URL parameter (default key) that carries the key. A header always carries it as a Bearer token',
      )
      .option('--streaming', 'The destination supports streamed responses')
      .option(
        '--name <name>',
        'A platform client: its name, lower-case letters, digits and dashes (such as github)',
      )
      .option(
        '--label <label>',
        'A platform client: the name connect mode shows (such as "Boxel (read-only)")',
      )
      .option('--client-id <id>', "A platform client: the vendor's client id")
      .option(
        '--authorize-url <url>',
        "A platform client: the vendor's authorization page",
      )
      .option(
        '--token-url <url>',
        "A platform client: the vendor's token endpoint",
      )
      .option(
        '--scopes <scopes>',
        'A platform client: the scopes it asks for, space-separated (none for a GitHub App, whose permissions are its own)',
      )
      .option(
        '--token-auth <method>',
        'A platform client: client_secret_post (the default) or client_secret_basic',
      )
      .option(
        '--api-host <url>',
        'A platform client: an API host it serves, where connect mode offers it; repeat for more',
        collect,
      ),
  )
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        if (kindOf(options) === 'oauth-client') {
          await addClientCommand(options);
          return;
        }
        refuseClientOptions(options);
        if (!options.destination) {
          throw new Error('A system key needs --destination');
        }
        if (!['openrouter', 'none'].includes(options.creditStrategy ?? '')) {
          throw new Error('--credit-strategy must be openrouter or none');
        }
        let auth = options.auth ?? 'header';
        if (!['header', 'url-parameter'].includes(auth)) {
          throw new Error('--auth must be header or url-parameter');
        }
        let seed = await seedOptions(options);
        let value = await readKeyValue(options);
        let note = await readNote(options.note, {
          stdinUsed: Boolean(options.stdin),
        });
        let key = await addSystemKey(seed, {
          destination: options.destination,
          authMethod: auth as SystemKeyAuthMethod,
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
        "Replace a system key's value, keeping its destination and settings, or with --kind oauth-client a platform client's secret, which also clears a secret its token endpoint refused",
      )
      .requiredOption('--realm-server <url>', 'The realm server to change')
      .option('--kind <kind>', KIND_HELP)
      .option('--id <id>', SELECT_HELP.id)
      .option('--destination <url>', SELECT_HELP.destination)
      .option('--name <name>', SELECT_HELP.name),
  )
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        if (kindOf(options) === 'oauth-client') {
          let name = clientName(options);
          let seed = await seedOptions(options);
          let secret = await readKeyValue(options);
          let note = await readNote(options.note, {
            stdinUsed: Boolean(options.stdin),
          });
          let client = await replacePlatformClientSecret(seed, name, {
            secret,
            note,
          });
          output(options.json, client, () => {
            console.log(
              `${FG_GREEN}Replaced the platform client's secret.${RESET}`,
            );
            printClient(client);
          });
          return;
        }
        refuseClientOptions(options);
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
    .description(
      'Delete a system key, so the proxy stops serving its destination, or with --kind oauth-client a platform client, whose connections then need an administrator',
    )
    .requiredOption('--realm-server <url>', 'The realm server to change')
    .option('--kind <kind>', KIND_HELP)
    .option('--id <id>', SELECT_HELP.id)
    .option('--destination <url>', SELECT_HELP.destination)
    .option('--name <name>', SELECT_HELP.name)
    .option(
      '--note <text>',
      'The operator note recorded with the change: who made it and why (prompted for when omitted). A name in it is recorded as given, not verified',
    )
    .option('--json', 'Output JSON')
    .action(async (options: KeysCliOptions) =>
      run(async () => {
        if (kindOf(options) === 'oauth-client') {
          let name = clientName(options);
          let seed = await seedOptions(options);
          let note = await readNote(options.note, { stdinUsed: false });
          await deletePlatformClient(seed, name, { note });
          output(options.json, { deleted: name }, () => {
            console.log(
              `${FG_GREEN}Deleted the platform client ${name}.${RESET}`,
            );
          });
          return;
        }
        refuseClientOptions(options);
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

// A platform client takes none of a system key's settings.
export function refuseSystemOptions(options: KeysCliOptions): void {
  let systemOnly = (
    [
      ['destination', '--destination'],
      ['creditStrategy', '--credit-strategy'],
      ['auth', '--auth'],
      ['paramName', '--param-name'],
      ['streaming', '--streaming'],
    ] as const
  ).filter(([option]) => options[option] !== undefined);
  if (systemOnly.length > 0) {
    throw new Error(
      `${systemOnly.map(([, flag]) => flag).join(', ')} ${systemOnly.length === 1 ? 'is' : 'are'} for a system key, not a platform client`,
    );
  }
}

async function addClientCommand(options: KeysCliOptions): Promise<void> {
  refuseSystemOptions(options);
  let missing = (
    [
      ['name', '--name'],
      ['label', '--label'],
      ['clientId', '--client-id'],
      ['authorizeUrl', '--authorize-url'],
      ['tokenUrl', '--token-url'],
      ['apiHost', '--api-host'],
    ] as const
  ).filter(([option]) => !options[option]);
  if (missing.length > 0) {
    throw new Error(
      `A platform client needs ${missing.map(([, flag]) => flag).join(', ')}`,
    );
  }
  if (
    options.tokenAuth !== undefined &&
    !['client_secret_post', 'client_secret_basic'].includes(options.tokenAuth)
  ) {
    throw new Error(
      '--token-auth must be client_secret_post or client_secret_basic',
    );
  }
  let seed = await seedOptions(options);
  let secret = await readKeyValue(options);
  let note = await readNote(options.note, {
    stdinUsed: Boolean(options.stdin),
  });
  let client = await addPlatformClient(seed, {
    name: options.name!,
    label: options.label!,
    secret,
    note,
    oauth: {
      clientId: options.clientId!,
      authorizeUrl: options.authorizeUrl!,
      tokenUrl: options.tokenUrl!,
      ...(options.scopes !== undefined ? { scopes: options.scopes } : {}),
      ...(options.tokenAuth !== undefined
        ? {
            tokenAuth: options.tokenAuth as
              | 'client_secret_post'
              | 'client_secret_basic',
          }
        : {}),
      apiHosts: options.apiHost!,
    },
  });
  output(options.json, client, () => {
    console.log(`${FG_GREEN}Added the platform client.${RESET}`);
    printClient(client);
  });
}
