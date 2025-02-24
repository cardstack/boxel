import { spawn } from 'child_process';
import { resolve, join } from 'path';
// @ts-expect-error no types
import { dirSync, setGracefulCleanup } from 'tmp';
import { ensureDirSync, copySync, readFileSync } from 'fs-extra';

setGracefulCleanup();

const testRealmCards = resolve(
  join(__dirname, '..', '..', 'host', 'tests', 'cards'),
);
const seedPath = resolve(join(__dirname, '..', '..', 'seed-realm'));
const realmServerDir = resolve(join(__dirname, '..', '..', 'realm-server'));
const matrixDir = resolve(join(__dirname, '..'));
export const appURL = 'http://localhost:4205/test';

// The isolated realm is fairly expensive to test with. Please use your best
// judgement to decide if your test really merits an isolated realm for testing
// or if a mock would be more suitable.

export async function startServer(opts?: { includeSeedRealm: boolean }) {
  let dir = dirSync();
  let testRealmDir = join(dir.name, 'test');
  ensureDirSync(testRealmDir);
  copySync(testRealmCards, testRealmDir);

  process.env.PGPORT = '5435';
  process.env.PGDATABASE = `test_db_${Math.floor(10000000 * Math.random())}`;
  process.env.NODE_NO_WARNINGS = '1';
  process.env.REALM_SERVER_SECRET_SEED = "mum's the word";
  process.env.REALM_SECRET_SEED = "shhh! it's a secret";
  process.env.MATRIX_URL = 'http://localhost:8008';
  process.env.REALM_SERVER_MATRIX_USERNAME = 'realm_server';
  process.env.NODE_ENV = 'test';

  let workerArgs = [
    `--transpileOnly`,
    'worker-manager',
    `--port=4212`,
    `--matrixURL='http://localhost:8008'`,
    `--distURL="${process.env.HOST_URL ?? 'http://localhost:4200'}"`,

    `--fromUrl='http://localhost:4205/test/'`,
    `--toUrl='http://localhost:4205/test/'`,
  ];
  if (opts?.includeSeedRealm) {
    workerArgs = workerArgs.concat([
      `--fromUrl='http://localhost:4205/seed/'`,
      `--toUrl='http://localhost:4205/seed/'`,
    ]);
  }
  workerArgs = workerArgs.concat([
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='http://localhost:4201/base/'`,
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
    `--matrixURL='http://localhost:8008'`,
    `--realmsRootPath='${dir.name}'`,
    `--seedPath='${seedPath}'`,
    `--seedRealmURL='http://localhost:4205/seed/'`,
    `--workerManagerPort=4212`,
    `--migrateDB`,
    `--useRegistrationSecretFunction`,

    `--path='${testRealmDir}'`,
    `--username='test_realm'`,
  ];
  serverArgs = serverArgs.concat([
    `--fromUrl='http://localhost:4205/test/'`,
    `--toUrl='http://localhost:4205/test/'`,
  ]);
  if (opts?.includeSeedRealm) {
    serverArgs = serverArgs.concat([
      `--path='${seedPath}'`,
      `--username='seed_realm'`,
      `--fromUrl='http://localhost:4205/seed/'`,
      `--toUrl='http://localhost:4205/seed/'`,
    ]);
  }
  serverArgs = serverArgs.concat([
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='http://localhost:4201/base/'`,
  ]);
  let realmServer = spawn('ts-node', serverArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
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
      realmServer.on('message', (message) => {
        if (message === 'ready') {
          r();
        }
      });
    }),
    new Promise<true>((r) => setTimeout(() => r(true), 60_000)),
  ]);
  if (timeout) {
    throw new Error(
      `timed-out waiting for realm server to start. Stopping server`,
    );
  }

  return new IsolatedRealmServer(realmServer, workerManager, testRealmDir);
}

export class IsolatedRealmServer {
  private realmServerStopped: (() => void) | undefined;
  private workerManagerStopped: (() => void) | undefined;
  private sqlResults: ((results: string) => void) | undefined;
  private sqlError: ((error: string) => void) | undefined;

  constructor(
    private realmServerProcess: ReturnType<typeof spawn>,
    private workerManagerProcess: ReturnType<typeof spawn>,
    readonly realmPath: string, // useful for debugging
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
