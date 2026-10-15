import type { Command } from 'commander';
import { cliLog } from '../../lib/cli-log.ts';
import { FG_GREEN, FG_YELLOW, RESET } from '../../lib/colors.ts';
import { resolveRealmSecretSeed } from '../../lib/prompt.ts';
import { operatorRequest } from '../../lib/seed-auth.ts';

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
  options: DataKeysOptions,
  path: string,
  method: 'GET' | 'POST',
): Promise<any> {
  let { url, response } = await operatorRequest(
    options,
    'data-keys',
    path,
    method,
  );
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

// Starts a re-seal pass on the realm server that answers, which refuses (409)
// unless its current data key is `currentKeyId`. With `wait`, polls until the
// pass finishes and returns the final status. Behind a load balancer a poll can
// reach another task: one on another revision reports against another current
// key, and any task reports its own pass, so the wait reads only answers made
// under `currentKeyId`, and ends when no row is left to re-seal or when the
// pass it started (known by its start time) reports finished.
export async function dataKeysReseal(
  options: DataKeysOptions & {
    currentKeyId: string;
    wait?: boolean;
    pollIntervalMs?: number;
    timeoutMs?: number;
  },
): Promise<{ started: boolean; status: DataKeyStatus }> {
  let { started, pass } = (await operatorFetch(
    options,
    `_data-keys/reseal?currentKeyId=${encodeURIComponent(options.currentKeyId)}`,
    'POST',
  )) as { started: boolean; pass: ResealPassState };
  let deadline = Date.now() + (options.timeoutMs ?? 60 * 60 * 1000);
  let status = await dataKeysStatus(options);
  let finished = (status: DataKeyStatus) =>
    status.currentKeyId === options.currentKeyId &&
    (status.rowsToReseal === 0 ||
      (status.pass.startedAt === pass.startedAt && !status.pass.running));
  while (options.wait && !finished(status)) {
    if (Date.now() > deadline) {
      throw new Error(
        `the re-seal pass did not finish in time; ${status.rowsToReseal} rows were left. Run status to see where it stands`,
      );
    }
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
  currentKey?: string;
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
    .requiredOption(
      '--current-key <key-id>',
      'The data key every server should have as current (status shows it); a server whose current key differs refuses',
    )
    .option('--wait', 'Wait for the pass to finish and report it')
    .option('--json', 'Output JSON')
    .action(async (options: DataKeysCliOptions) =>
      run(async () => {
        let { started, status } = await dataKeysReseal({
          ...(await seedOptions(options)),
          currentKeyId: options.currentKey!,
          wait: options.wait,
        });
        if (options.json) {
          cliLog.output(JSON.stringify({ started, ...status }, null, 2));
        } else {
          console.log(
            started
              ? `${FG_GREEN}Started a re-seal pass.${RESET}`
              : 'A re-seal pass is already running on this server.',
          );
          printStatus(status);
        }
        // A finished wait that leaves rows behind needs the operator.
        if (options.wait && status.rowsToReseal > 0) {
          process.exitCode = 1;
        }
      }),
    );
}
