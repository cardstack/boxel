import { spawn, type ChildProcess } from 'child_process';
import { resolve, join } from 'path';
// @ts-expect-error no types
import { dirSync, setGracefulCleanup } from 'tmp';
import { ensureDirSync, copySync, readFileSync } from 'fs-extra';
import { Pool } from 'pg';
import { createServer as createNetServer, type AddressInfo } from 'net';
import type { SynapseInstance } from '../docker/synapse';

setGracefulCleanup();

const testRealmCards = resolve(
  join(__dirname, '..', '..', 'host', 'tests', 'cards'),
);
const realmServerDir = resolve(join(__dirname, '..', '..', 'realm-server'));
const skillsRealmDir = resolve(
  join(__dirname, '..', '..', 'skills-realm', 'contents'),
);
const baseRealmDir = resolve(join(__dirname, '..', '..', 'base'));
const matrixDir = resolve(join(__dirname, '..'));
export const appURL = 'http://localhost:4205/test';

const DEFAULT_PRERENDER_PORT = 4231;
const DEFAULT_WORKER_MANAGER_READY_TIMEOUT_MS = 120_000;
const DEFAULT_WORKER_START_TIMEOUT_MS = 90_000;
const DEFAULT_REALM_SERVER_START_TIMEOUT_MS = 120_000;
const STARTUP_LOG_TAIL_LINES = 80;

export interface PrerenderServerConfig {
  port?: number;
}

export interface RunningPrerenderServer {
  port: number;
  url: string;
  stop(): Promise<void>;
}

export interface StartRealmServerOptions {
  synapse: SynapseInstance;
  prerenderURL: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTimeoutMs(
  rawValue: string | undefined,
  fallbackMs: number,
): number {
  let parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function pushOutputTail(
  output: string[],
  prefix: string,
  data: Buffer,
): void {
  for (let line of data.toString().split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    output.push(`${prefix}${line}`);
  }
  if (output.length > STARTUP_LOG_TAIL_LINES) {
    output.splice(0, output.length - STARTUP_LOG_TAIL_LINES);
  }
}

function readMetadataFile(filePath: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return undefined;
  }
}

function describeChildProcess(proc: ChildProcess | undefined) {
  if (!proc) {
    return { started: false };
  }
  return {
    started: true,
    pid: proc.pid ?? null,
    exitCode: proc.exitCode,
    signalCode: proc.signalCode,
    killed: proc.killed,
    connected: 'connected' in proc ? proc.connected : undefined,
  };
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    value: String(error),
  };
}

function buildStartupFailure(
  reason: unknown,
  diagnostics: Record<string, unknown>,
): Error {
  let message =
    reason instanceof Error ? reason.message : `Startup failed: ${String(reason)}`;
  return new Error(
    `${message}\nStartup diagnostics:\n${JSON.stringify(
      {
        ...diagnostics,
        startupFailure: describeError(reason),
      },
      null,
      2,
    )}`,
    reason instanceof Error ? { cause: reason } : undefined,
  );
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    let tester = createNetServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(preferred?: number): Promise<number> {
  if (typeof preferred === 'number' && (await isPortAvailable(preferred))) {
    return preferred;
  }
  return await new Promise((resolve, reject) => {
    let server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      let address = server.address() as AddressInfo | null;
      server.close(() => {
        if (address?.port) {
          resolve(address.port);
        } else {
          reject(new Error('Could not determine available port'));
        }
      });
    });
  });
}

async function waitForHttpReady(url: string, timeoutMs = 60_000) {
  let start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      let response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (e) {
      // ignore; server not ready yet
    }
    await delay(200);
  }
  throw new Error(`timed out waiting for ${url} to become ready`);
}

function stopChildProcess(
  proc: ChildProcess | undefined,
  signal: NodeJS.Signals = 'SIGINT',
) {
  return new Promise<void>((resolve) => {
    if (!proc) {
      resolve();
      return;
    }
    if (proc.exitCode !== null || proc.killed) {
      resolve();
      return;
    }
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let onExit = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    let onError = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    function cleanup() {
      if (timer) {
        clearTimeout(timer);
      }
      proc.removeListener('exit', onExit);
      proc.removeListener('error', onError);
    }
    proc.once('exit', onExit);
    proc.once('error', onError);
    timer = setTimeout(() => {
      if (!settled) {
        proc.kill('SIGTERM');
      }
    }, 5_000);
    proc.kill(signal);
  });
}

// The isolated realm is fairly expensive to test with. Please use your best
// judgement to decide if your test really merits an isolated realm for testing
// or if a mock would be more suitable.

export async function startPrerenderServer(
  options?: PrerenderServerConfig,
): Promise<RunningPrerenderServer> {
  let port = await findAvailablePort(options?.port ?? DEFAULT_PRERENDER_PORT);
  let url = `http://localhost:${port}`;
  let env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    NODE_NO_WARNINGS: '1',
    BOXEL_HOST_URL: process.env.HOST_URL ?? 'http://localhost:4200',
    LOG_LEVELS:
      process.env.SOFTWARE_FACTORY_PRERENDER_LOG_LEVELS ?? process.env.LOG_LEVELS,
  };
  let prerenderArgs = [
    '--transpileOnly',
    'prerender/prerender-server',
    `--port=${port}`,
  ];

  let child = spawn('ts-node', prerenderArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  child.stdout?.on('data', (data: Buffer) =>
    console.log(`prerender: ${data.toString()}`),
  );
  child.stderr?.on('data', (data: Buffer) =>
    console.error(`prerender: ${data.toString()}`),
  );

  let exitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  let errorListener: ((err: Error) => void) | undefined;

  const exitPromise = new Promise<never>((_, reject) => {
    exitListener = (code: number | null, signal: NodeJS.Signals | null) => {
      reject(
        new Error(
          `prerender server exited before it became ready (code: ${code}, signal: ${signal})`,
        ),
      );
    };
    errorListener = (err: Error) => {
      reject(err);
    };
    child.once('exit', exitListener);
    child.once('error', errorListener);
  });

  try {
    await Promise.race([waitForHttpReady(url, 60_000), exitPromise]);
  } finally {
    if (exitListener) {
      child.removeListener('exit', exitListener);
    }
    if (errorListener) {
      child.removeListener('error', errorListener);
    }
  }

  return {
    port,
    url,
    async stop() {
      await stopChildProcess(child);
    },
  };
}

export async function startServer({
  synapse,
  prerenderURL,
}: StartRealmServerOptions) {
  let dir = dirSync();
  let testRealmDir = join(dir.name, 'test');
  ensureDirSync(testRealmDir);
  copySync(testRealmCards, testRealmDir);

  let testDBName = `test_db_${Math.floor(10000000 * Math.random())}`;
  let workerManagerPort = await findAvailablePort(4232);
  let workerManagerReadyTimeoutMs = parseTimeoutMs(
    process.env.TEST_HARNESS_WORKER_MANAGER_READY_TIMEOUT_MS,
    DEFAULT_WORKER_MANAGER_READY_TIMEOUT_MS,
  );
  let workerStartTimeoutMs = parseTimeoutMs(
    process.env.TEST_HARNESS_WORKER_START_TIMEOUT_MS,
    DEFAULT_WORKER_START_TIMEOUT_MS,
  );
  let realmServerStartTimeoutMs = parseTimeoutMs(
    process.env.TEST_HARNESS_REALM_SERVER_START_TIMEOUT_MS,
    DEFAULT_REALM_SERVER_START_TIMEOUT_MS,
  );
  let workerManagerMetadataFile = join(dir.name, 'worker-manager-metadata.json');
  let realmServerMetadataFile = join(dir.name, 'realm-server-metadata.json');
  let workerManagerOutput: string[] = [];
  let realmServerOutput: string[] = [];
  let realmServer: ReturnType<typeof spawn> | undefined;

  process.env.PGPORT = '5435';
  process.env.PGDATABASE = testDBName;
  process.env.NODE_NO_WARNINGS = '1';
  process.env.REALM_SERVER_SECRET_SEED = "mum's the word";
  process.env.REALM_SECRET_SEED = "shhh! it's a secret";
  process.env.GRAFANA_SECRET = "shhh! it's a secret";
  let matrixURL = `http://localhost:${synapse.port}`;
  process.env.MATRIX_URL = matrixURL;
  process.env.REALM_SERVER_MATRIX_USERNAME = 'realm_server';
  process.env.NODE_ENV = 'test';
  process.env.LOW_CREDIT_THRESHOLD = '2000';

  let workerArgs = [
    `--transpileOnly`,
    'worker-manager',
    `--port=${workerManagerPort}`,
    `--matrixURL='${matrixURL}'`,
    `--prerendererUrl='${prerenderURL}'`,
    `--migrateDB`,

    `--fromUrl='http://localhost:4205/test/'`,
    `--toUrl='http://localhost:4205/test/'`,
  ];
  workerArgs = workerArgs.concat([
    `--fromUrl='@cardstack/skills/'`,
    `--toUrl='http://localhost:4205/skills/'`,
  ]);
  workerArgs = workerArgs.concat([
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='http://localhost:4205/base/'`,
  ]);

  let workerManager = spawn('ts-node', workerArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      TEST_HARNESS_WORKER_START_TIMEOUT_MS: String(workerStartTimeoutMs),
      TEST_HARNESS_WORKER_MANAGER_METADATA_FILE: workerManagerMetadataFile,
    },
  });
  if (workerManager.stdout) {
    workerManager.stdout.on('data', (data: Buffer) => {
      pushOutputTail(workerManagerOutput, 'stdout: ', data);
      console.log(`worker: ${data.toString()}`);
    });
  }
  if (workerManager.stderr) {
    workerManager.stderr.on('data', (data: Buffer) => {
      pushOutputTail(workerManagerOutput, 'stderr: ', data);
      console.error(`worker: ${data.toString()}`);
    });
  }

  let workerManagerExitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  let workerManagerErrorListener: ((err: Error) => void) | undefined;
  let workerManagerExitPromise = new Promise<never>((_, reject) => {
    workerManagerExitListener = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      reject(
        new Error(
          `worker manager exited before it became ready (code: ${code}, signal: ${signal})`,
        ),
      );
    };
    workerManagerErrorListener = (err: Error) => reject(err);
    workerManager.once('exit', workerManagerExitListener);
    workerManager.once('error', workerManagerErrorListener);
  });

  let startupDiagnostics = () => ({
    realmPath: testRealmDir,
    database: testDBName,
    workerManagerPort,
    workerManagerReadyTimeoutMs,
    workerStartTimeoutMs,
    realmServerStartTimeoutMs,
    workerManagerState: describeChildProcess(workerManager),
    realmServerState: describeChildProcess(realmServer),
    workerManagerMetadata: readMetadataFile(workerManagerMetadataFile),
    realmServerMetadata: readMetadataFile(realmServerMetadataFile),
    workerManagerOutputTail: workerManagerOutput,
    realmServerOutputTail: realmServerOutput,
  });

  try {
    await Promise.race([
      waitForHttpReady(
        `http://localhost:${workerManagerPort}`,
        workerManagerReadyTimeoutMs,
      ),
      workerManagerExitPromise,
    ]);
  } catch (error) {
    await stopChildProcess(workerManager);
    throw buildStartupFailure(error, startupDiagnostics());
  } finally {
    if (workerManagerExitListener) {
      workerManager.removeListener('exit', workerManagerExitListener);
    }
    if (workerManagerErrorListener) {
      workerManager.removeListener('error', workerManagerErrorListener);
    }
  }

  let serverArgs = [
    `--transpileOnly`,
    'main',
    `--port=4205`,
    `--matrixURL='${matrixURL}'`,
    `--realmsRootPath='${dir.name}'`,
    `--workerManagerPort=${workerManagerPort}`,
    `--prerendererUrl="${prerenderURL}"`,
    `--useRegistrationSecretFunction`,

    `--path='${testRealmDir}'`,
    `--username='test_realm'`,
    `--fromUrl='http://localhost:4205/test/'`,
    `--toUrl='http://localhost:4205/test/'`,
  ];
  serverArgs = serverArgs.concat([
    `--username='skills_realm'`,
    `--path='${skillsRealmDir}'`,
    `--fromUrl='@cardstack/skills/'`,
    `--toUrl='http://localhost:4205/skills/'`,
  ]);
  serverArgs = serverArgs.concat([
    `--username='base_realm'`,
    `--path='${baseRealmDir}'`,
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='http://localhost:4205/base/'`,
  ]);

  console.log(`realm server database: ${testDBName}`);

  realmServer = spawn('ts-node', serverArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      // Matrix tests don't exercise GitHub PR creation, so disable that route
      // to avoid pulling Octokit into the realm server startup path.
      DISABLE_GITHUB_PR_ROUTE: 'true',
      PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: 'localhost:4205',
      PUBLISHED_REALM_BOXEL_SITE_DOMAIN: 'localhost:4205',
      TEST_HARNESS_REALM_SERVER_METADATA_FILE: realmServerMetadataFile,
    },
  });
  realmServer.unref();
  if (realmServer.stdout) {
    realmServer.stdout.on('data', (data: Buffer) => {
      pushOutputTail(realmServerOutput, 'stdout: ', data);
      console.log(`realm server: ${data.toString()}`);
    });
  }
  if (realmServer.stderr) {
    realmServer.stderr.on('data', (data: Buffer) => {
      pushOutputTail(realmServerOutput, 'stderr: ', data);
      console.error(`realm server: ${data.toString()}`);
    });
  }
  realmServer.on('message', (message) => {
    if (message === 'get-registration-secret' && realmServer.send) {
      let secret = readFileSync(
        join(matrixDir, 'registration_secret.txt'),
        'utf8',
      );
      realmServer.send(`registration-secret:${secret}`);
    }
  });

  let realmServerExitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  let realmServerErrorListener: ((err: Error) => void) | undefined;
  let realmServerReadyListener: ((message: unknown) => void) | undefined;
  let realmServerStartTimeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        realmServerReadyListener = (message: unknown) => {
          if (message === 'ready') {
            realmServer?.off('message', realmServerReadyListener);
            resolve();
          }
        };
        realmServer.on('message', realmServerReadyListener);
      }),
      new Promise<never>((_, reject) => {
        realmServerExitListener = (
          code: number | null,
          signal: NodeJS.Signals | null,
        ) => {
          reject(
            new Error(
              `realm server exited before it became ready (code: ${code}, signal: ${signal})`,
            ),
          );
        };
        realmServerErrorListener = (err: Error) => reject(err);
        realmServer.once('exit', realmServerExitListener);
        realmServer.once('error', realmServerErrorListener);
      }),
      new Promise<never>((_, reject) => {
        realmServerStartTimeout = setTimeout(() => {
          reject(
            new Error(
              `timed-out waiting for realm server to start after ${realmServerStartTimeoutMs}ms. Stopping server`,
            ),
          );
        }, realmServerStartTimeoutMs);
        realmServerStartTimeout.unref();
      }),
    ]);
  } catch (error) {
    await Promise.all([
      stopChildProcess(realmServer),
      stopChildProcess(workerManager),
    ]);
    throw buildStartupFailure(error, startupDiagnostics());
  } finally {
    if (realmServerExitListener) {
      realmServer.removeListener('exit', realmServerExitListener);
    }
    if (realmServerErrorListener) {
      realmServer.removeListener('error', realmServerErrorListener);
    }
    if (realmServerReadyListener) {
      realmServer.removeListener('message', realmServerReadyListener);
    }
    if (realmServerStartTimeout) {
      clearTimeout(realmServerStartTimeout);
    }
  }

  return new IsolatedRealmServer(
    realmServer,
    workerManager,
    testRealmDir,
    testDBName,
  );
}

export interface SQLExecutor {
  executeSQL(sql: string): Promise<Record<string, any>[]>;
}

export class BasicSQLExecutor implements SQLExecutor {
  pool: Pool;
  constructor(readonly db: string) {
    this.pool = new Pool({
      host: 'localhost',
      port: 5435,
      user: 'postgres',
      password: '', // trust auth, so no password needed
      database: db, // default database to connect to
    });
  }
  async executeSQL(sql: string) {
    const client = await this.pool.connect();
    try {
      let { rows } = await client.query(sql);
      return rows;
    } finally {
      client.release();
    }
  }
}

export class IsolatedRealmServer implements SQLExecutor {
  private realmServerStopped: (() => void) | undefined;
  private workerManagerStopped: (() => void) | undefined;
  private sqlResults: ((results: string) => void) | undefined;
  private sqlError: ((error: string) => void) | undefined;

  constructor(
    private realmServerProcess: ReturnType<typeof spawn>,
    private workerManagerProcess: ReturnType<typeof spawn>,
    readonly realmPath: string, // useful for debugging
    readonly db: string,
  ) {
    workerManagerProcess.on('message', (message) => {
      if (message === 'stopped') {
        if (!this.workerManagerStopped) {
          console.error(`received unprompted worker manager stop`);
          return;
        }
        this.workerManagerStopped();
      }
    });
    realmServerProcess.on('message', (message) => {
      if (message === 'stopped') {
        if (!this.realmServerStopped) {
          console.error(`received unprompted server stop`);
          return;
        }
        this.realmServerStopped();
      } else if (
        typeof message === 'string' &&
        message.startsWith('sql-results:')
      ) {
        let results = message.substring('sql-results:'.length);
        if (!this.sqlResults) {
          console.error(`received unprompted SQL: ${results}`);
          return;
        }
        this.sqlResults(results);
      } else if (
        typeof message === 'string' &&
        message.startsWith('sql-error:')
      ) {
        let error = message.substring('sql-error:'.length);
        if (!this.sqlError) {
          console.error(`received unprompted SQL error: ${error}`);
          return;
        }
        this.sqlError(error);
      }
    });
  }

  async executeSQL(sql: string): Promise<Record<string, any>[]> {
    let execute = new Promise<string>(
      (resolve, reject: (reason: string) => void) => {
        this.sqlResults = resolve;
        this.sqlError = reject;
      },
    );
    this.realmServerProcess.send(`execute-sql:${sql}`);
    let resultsStr = await execute;
    this.sqlResults = undefined;
    this.sqlError = undefined;
    return JSON.parse(resultsStr);
  }

  async stop() {
    let realmServerStop = new Promise<void>(
      (r) => (this.realmServerStopped = r),
    );
    this.realmServerProcess.send('stop');
    await realmServerStop;
    this.realmServerStopped = undefined;
    this.realmServerProcess.send('kill');

    let workerManagerStop = new Promise<void>(
      (r) => (this.workerManagerStopped = r),
    );
    this.workerManagerProcess.send('stop');
    await workerManagerStop;
    this.workerManagerStopped = undefined;
    this.workerManagerProcess.send('kill');
  }
}
