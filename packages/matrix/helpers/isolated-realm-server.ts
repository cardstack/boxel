import { spawn } from 'child_process';
import { resolve, join } from 'path';
// @ts-expect-error no types
import { dirSync, setGracefulCleanup } from 'tmp';
import { ensureDirSync, copySync } from 'fs-extra';

setGracefulCleanup();

const testRealmCards = resolve(
  join(__dirname, '..', '..', 'host', 'tests', 'cards'),
);
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
      `--matrixRegistrationSecretFile='${join(
        matrixDir,
        'registration_secret.txt',
      )}`,
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

  let timeout = await Promise.race([
    new Promise<void>((r) => {
      realmServer.on('message', (message) => {
        if (message === 'ready') {
          r();
        }
      });
    }),
    new Promise<true>((r) => setTimeout(() => r(true), 30_000)),
  ]);
  if (timeout) {
    console.error(
      `timed-out waiting for realm server to start. Stopping server`,
    );
    process.exit(-2);
  }

  return new IsolatedRealmServer(realmServer);
}

export class IsolatedRealmServer {
  constructor(private realmServerProcess: ReturnType<typeof spawn>) {}

  async stop() {
    let stopped: () => void;
    let stop = new Promise<void>((r) => (stopped = r));
    this.realmServerProcess.on('message', (message) => {
      if (message === 'stopped') {
        stopped();
      }
    });
    this.realmServerProcess.send('stop');
    await stop;
    this.realmServerProcess.kill();
  }
}
