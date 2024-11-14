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

export async function startServer() {
  let dir = dirSync();
  let testRealmDir = join(dir.name, 'test');
  ensureDirSync(testRealmDir);
  copySync(testRealmCards, testRealmDir);

  process.env.PGPORT = '5435';
  process.env.PGDATABASE = `test_db_${Math.floor(10000000 * Math.random())}`;
  process.env.NODE_NO_WARNINGS = '1';
  process.env.REALM_SECRET_SEED = "shhh! it's a secret";
  process.env.MATRIX_URL = 'http://localhost:8008';
  process.env.REALM_SERVER_MATRIX_USERNAME = 'realm_server';

  let realmServer = spawn(
    'ts-node',
    [
      `--transpileOnly`,
      'main',
      `--port=4205`,
      `--matrixURL='http://localhost:8008'`,
      `--realmsRootPath='${dir.name}'`,
      `--seedPath='${seedPath}'`,
      `--migrateDB`,
      `--useRegistrationSecretFunction`,

      `--path='${testRealmDir}'`,
      `--username='test_realm'`,
      `--fromUrl='/test/'`,
      `--toUrl='/test/'`,
      `--fromUrl='https://cardstack.com/base/'`,
      `--toUrl='http://localhost:4201/base/'`,
    ],
    {
      cwd: realmServerDir,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    },
  );
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

  return new IsolatedRealmServer(realmServer, testRealmDir);
}

export class IsolatedRealmServer {
  private stopped: (() => void) | undefined;
  private sqlResults: ((results: string) => void) | undefined;
  private sqlError: ((error: string) => void) | undefined;

  constructor(
    private realmServerProcess: ReturnType<typeof spawn>,
    readonly realmPath: string, // useful for debugging
  ) {
    realmServerProcess.on('message', (message) => {
      if (message === 'stopped') {
        if (!this.stopped) {
          console.error(`received unprompted server stop`);
          return;
        }
        this.stopped();
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
    let stop = new Promise<void>((r) => (this.stopped = r));
    this.realmServerProcess.send('stop');
    await stop;
    this.stopped = undefined;
    this.realmServerProcess.send('kill');
  }
}
