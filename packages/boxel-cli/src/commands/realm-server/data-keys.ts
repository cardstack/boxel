import type { Command } from 'commander';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_GREEN, FG_YELLOW, RESET } from '../../lib/colors.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { mintOperatorToken } from '../../lib/seed-auth.ts';

// `boxel realm-server data-keys`: where a rotation of the data key that seals
// the realm server's stored secrets stands, and the pass that re-seals stored
// rows under the current data key. Authorized with the realm secret seed.

export interface ResealColumnReport {
  field: string;
  resealed: number;
  changedConcurrently: number;
  unopenable: number;
}

export interface ResealPassState {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  report?: {
    currentKeyId: string;
    columns: ResealColumnReport[];
    interrupted: boolean;
  };
  error?: string;
}

export interface DataKeyStatus {
  currentKeyId: string;
  loadedKeyIds: string[];
  columns: { field: string; rowsByKeyId: Record<string, number> }[];
  rowsToReseal: number;
  retirableKeyIds: string[];
  unloadedKeyIds: string[];
  pass: ResealPassState;
}

export interface DataKeysOptions {
  realmServerUrl: string;
  realmSecretSeed: string;
  fetch?: typeof globalThis.fetch;
}

async function operatorFetch(
  {
    realmServerUrl,
    realmSecretSeed,
    fetch = globalThis.fetch,
  }: DataKeysOptions,
  path: string,
  method: 'GET' | 'POST',
): Promise<any> {
  let url = new URL(path, ensureTrailingSlash(realmServerUrl)).href;
  let response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${mintOperatorToken(realmSecretSeed, 'data-keys')}`,
    },
  });
  if (!response.ok) {
    let body = await response.text().catch(() => '');
    throw new Error(
      `${method} ${url} answered HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  return response.json();
}

export async function dataKeysStatus(
  options: DataKeysOptions,
): Promise<DataKeyStatus> {
  return operatorFetch(options, '_data-keys', 'GET');
}

// Starts a re-seal pass on the realm server that answers. With `wait`, polls
// that server until its pass finishes and returns the final status. Behind a
// load balancer a poll can reach another task, whose pass state is its own;
// the row counts are the same from every task, so the wait ends once no row is
// left to re-seal or the pass that answers has finished.
export async function dataKeysReseal(
  options: DataKeysOptions & { wait?: boolean; pollIntervalMs?: number },
): Promise<{ started: boolean; status: DataKeyStatus }> {
  let { started } = (await operatorFetch(
    options,
    '_data-keys/reseal',
    'POST',
  )) as { started: boolean };
  let status = await dataKeysStatus(options);
  while (options.wait && status.pass.running && status.rowsToReseal > 0) {
    await new Promise((resolve) =>
      setTimeout(resolve, options.pollIntervalMs ?? 2000),
    );
    status = await dataKeysStatus(options);
  }
  return { started, status };
}

function printStatus(status: DataKeyStatus): void {
  console.log(`Current data key: ${status.currentKeyId}`);
  console.log(`Loaded data keys: ${status.loadedKeyIds.join(', ')}`);
  if (status.columns.length === 0) {
    console.log('No table seals its secrets with the helper.');
  }
  for (let { field, rowsByKeyId } of status.columns) {
    let counts = Object.entries(rowsByKeyId)
      .map(([keyId, count]) => `${keyId}=${count}`)
      .join(', ');
    console.log(`  ${field}: ${counts || 'no sealed rows'}`);
  }
  console.log(`Rows left to re-seal: ${status.rowsToReseal}`);
  console.log(
    `Retirable data keys: ${status.retirableKeyIds.join(', ') || 'none'}`,
  );
  if (status.unloadedKeyIds.length > 0) {
    console.log(
      `${FG_YELLOW}Rows reference data keys this server has not loaded: ${status.unloadedKeyIds.join(', ')}${RESET}`,
    );
  }
  let { pass } = status;
  if (pass.running) {
    console.log(`Re-seal pass: running since ${pass.startedAt}`);
  } else if (pass.error) {
    console.log(`${FG_YELLOW}Re-seal pass failed: ${pass.error}${RESET}`);
  } else if (pass.report) {
    console.log(
      `Re-seal pass: finished ${pass.finishedAt}${pass.report.interrupted ? ' (interrupted)' : ''}`,
    );
    for (let column of pass.report.columns) {
      console.log(
        `  ${column.field}: resealed=${column.resealed} changedConcurrently=${column.changedConcurrently} unopenable=${column.unopenable}`,
      );
    }
  } else {
    console.log('Re-seal pass: none has run on this server');
  }
}

interface DataKeysCliOptions {
  realmServer: string;
  json?: boolean;
  wait?: boolean;
}

async function seedOptions(
  options: DataKeysCliOptions,
): Promise<DataKeysOptions> {
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

export function registerDataKeysCommand(realmServer: Command): void {
  let dataKeys = realmServer
    .command('data-keys')
    .description(
      'Rotate the data key that seals stored secrets: report where a rotation stands and re-seal stored rows under the current data key',
    );

  dataKeys
    .command('status')
    .description(
      'Report the loaded data keys, the rows each sealed, the keys that can be retired, and the re-seal pass',
    )
    .requiredOption('--realm-server <url>', 'The realm server to ask')
    .option('--json', 'Output JSON')
    .action(async (options: DataKeysCliOptions) =>
      run(async () => {
        let status = await dataKeysStatus(await seedOptions(options));
        if (options.json) {
          cliLog.output(JSON.stringify(status, null, 2));
        } else {
          printStatus(status);
        }
      }),
    );

  dataKeys
    .command('reseal')
    .description(
      'Start a background pass that re-seals every stored row under the current data key. Safe to run again: it resumes where a stopped pass left off and changes nothing once every row is under the current key',
    )
    .requiredOption('--realm-server <url>', 'The realm server to run it on')
    .option('--wait', 'Wait for the pass to finish and report it')
    .option('--json', 'Output JSON')
    .action(async (options: DataKeysCliOptions) =>
      run(async () => {
        let { started, status } = await dataKeysReseal({
          ...(await seedOptions(options)),
          wait: options.wait,
        });
        if (options.json) {
          cliLog.output(JSON.stringify({ started, ...status }, null, 2));
          return;
        }
        console.log(
          started
            ? `${FG_GREEN}Started a re-seal pass.${RESET}`
            : 'A re-seal pass is already running on this server.',
        );
        printStatus(status);
      }),
    );
}
