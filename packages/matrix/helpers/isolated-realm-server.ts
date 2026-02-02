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

const DEFAULT_PRERENDER_PORT = 4221;

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
  proc: ChildProcess,
  signal: NodeJS.Signals = 'SIGINT',
) {
  return new Promise<void>((resolve) => {
    if (proc.exitCode !== null || proc.killed) {
      resolve();
      return;
    }
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    function cleanup() {
      if (timer) {
        clearTimeout(timer);
      }
      proc.removeAllListeners('exit');
      proc.removeAllListeners('error');
    }
    proc.once('exit', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });
    proc.once('error', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });
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
  };
  let prerenderArgs = [
    '--transpileOnly',
    'prerender/prerender-server',
    `--port=${port}`,
    '--silent',
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
  let workerManagerPort = await findAvailablePort(4212);

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
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='http://localhost:4205/base/'`,
  ]);

  let workerManager = spawn('ts-node', workerArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  if (workerManager.stdout) {
    workerManager.stdout.on('data', (data: Buffer) =>
      console.log(`worker: ${data.toString()}`),
    );
  }
  if (workerManager.stderr) {
    workerManager.stderr.on('data', (data: Buffer) =>
      console.error(`worker: ${data.toString()}`),
    );
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
    `--fromUrl='http://localhost:4205/skills/'`,
    `--toUrl='http://localhost:4205/skills/'`,
  ]);
  serverArgs = serverArgs.concat([
    `--username='base_realm'`,
    `--path='${baseRealmDir}'`,
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='http://localhost:4205/base/'`,
  ]);

  console.log(`realm server database: ${testDBName}`);

  let realmServer = spawn('ts-node', serverArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: 'localhost:4205',
      PUBLISHED_REALM_BOXEL_SITE_DOMAIN: 'localhost:4205',
    },
  });
  realmServer.unref();
  if (realmServer.stdout) {
    realmServer.stdout.on('data', (data: Buffer) =>
      console.log(`realm server: ${data.toString()}`),
    );
  }
  if (realmServer.stderr) {
    realmServer.stderr.on('data', (data: Buffer) =>
      console.error(`realm server: ${data.toString()}`),
    );
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

  let timeout = await Promise.race([
    new Promise<void>((r) => {
      if (!realmServer) {
        r();
        return;
      }
      const onMessage = (message: unknown) => {
        if (message === 'ready') {
          realmServer?.off('message', onMessage);
          r();
        }
      };
      realmServer.on('message', onMessage);
    }),
    new Promise<true>((r) => setTimeout(() => r(true), 60_000)),
  ]);
  if (timeout) {
    throw new Error(
      `timed-out waiting for realm server to start. Stopping server`,
    );
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
