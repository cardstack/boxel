import { spawn } from 'child_process';
import { resolve, join } from 'path';
// @ts-expect-error no types
import { dirSync, setGracefulCleanup } from 'tmp';
import { ensureDirSync, copySync, readFileSync } from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { getRegistrationSecretFilename } from '../docker/synapse';

setGracefulCleanup();

const testRealmCards = resolve(
  join(__dirname, '..', '..', 'host', 'tests', 'cards'),
);
const realmServerDir = resolve(join(__dirname, '..', '..', 'realm-server'));
const skillsRealmDir = resolve(
  join(__dirname, '..', '..', 'skills-realm', 'contents'),
);
const matrixDir = resolve(join(__dirname, '..'));
export const appURL = 'http://localhost:4205/test';

export function getAppURL(port = 4205) {
  return `http://localhost:${port}/test`;
}

function generateUniquePorts() {
  const basePort = 5000;
  const randomOffset = Math.floor(Math.random() * 10000);
  return {
    realmServerPort: basePort + randomOffset,
    workerManagerPort: basePort + randomOffset + 1,
  };
}

export async function startServer(
  includePublishedRealm = false,
  ports?: { realmServerPort: number; workerManagerPort: number },
  matrixURL = 'http://localhost:8009',
  synapsePort?: number,
) {
  let dir = dirSync();
  let testRealmDir = join(dir.name, 'test');
  ensureDirSync(testRealmDir);
  copySync(testRealmCards, testRealmDir);

  let uniquePorts = ports || generateUniquePorts();
  let { realmServerPort, workerManagerPort } = uniquePorts;

  let publishedRealmId = uuidv4();

  if (includePublishedRealm) {
    let publishedRealmDir = join(dir.name, '_published', publishedRealmId);
    ensureDirSync(publishedRealmDir);
    copySync(testRealmCards, publishedRealmDir);
  }

  process.env.PGPORT = '5435';
  process.env.PGDATABASE = `test_db_${Math.floor(10000000 * Math.random())}`;
  process.env.NODE_NO_WARNINGS = '1';
  process.env.REALM_SERVER_SECRET_SEED = "mum's the word";
  process.env.REALM_SECRET_SEED = "shhh! it's a secret";
  process.env.GRAFANA_SECRET = "shhh! it's a secret";
  process.env.MATRIX_URL = matrixURL;
  process.env.REALM_SERVER_MATRIX_USERNAME = 'realm_server';
  process.env.NODE_ENV = 'test';

  let workerArgs = [
    `--transpileOnly`,
    'worker-manager',
    `--port=${workerManagerPort}`,
    `--matrixURL='${matrixURL}'`,
    `--distURL="${process.env.HOST_URL ?? 'http://localhost:4200'}"`,
    `--migrateDB`,

    `--fromUrl='http://localhost:${realmServerPort}/test/'`,
    `--toUrl='http://localhost:${realmServerPort}/test/'`,
  ];
  workerArgs = workerArgs.concat([
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='http://localhost:4201/base/'`,
  ]);

  if (includePublishedRealm) {
    workerArgs = workerArgs.concat([
      `--fromUrl='http://published.realm/'`,
      `--toUrl='http://localhost:${realmServerPort}/published/'`,
    ]);
  }

  let workerManager = spawn('ts-node', workerArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  if (workerManager.stdout) {
    workerManager.stdout.on('data', (data: Buffer) =>
      console.log(`worker[${workerManagerPort}]: ${data.toString()}`),
    );
  }
  if (workerManager.stderr) {
    workerManager.stderr.on('data', (data: Buffer) =>
      console.error(`worker[${workerManagerPort}] sterr: ${data.toString()}`),
    );
  }

  let workerManagerStartupTimedOut = await Promise.race([
    new Promise<void>((resolve) => {
      let checkReady = async () => {
        try {
          let response = await fetch(`http://localhost:${workerManagerPort}/`);
          if (response.ok) {
            let json = await response.json();
            console.log(
              `response? wm${workerManagerPort}`,
              JSON.stringify(json, null, 2),
            );
            if (json.ready) {
              resolve();
              return;
            }
          }
        } catch (e) {}

        setTimeout(checkReady, 100);
      };

      checkReady();
    }),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), 30_000)),
  ]);

  if (workerManagerStartupTimedOut) {
    throw new Error(`timed out waiting for worker manager to start`);
  }

  let sqlExecutor = new WorkerManagerSQLExecutor(workerManager);

  // FIXME Rewrite 4205 ports in database to dynamic ports, is there a better way?
  await sqlExecutor.executeSQL(`
    UPDATE realm_user_permissions
    SET realm_url = REPLACE(realm_url, 'localhost:4205', 'localhost:${realmServerPort}')
    WHERE realm_url LIKE '%localhost:4205%'
  `);

  let realmsToSetup = [
    'test',
    'skills',
    'base',
    'catalog',
    'experiments',
    'seed',
  ];
  for (let realmPath of realmsToSetup) {
    await sqlExecutor.executeSQL(`
      INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
      VALUES ('http://localhost:${realmServerPort}/${realmPath}/', '@realm_server:localhost', true, true, true)
      ON CONFLICT (realm_url, username)
      DO UPDATE SET read = true, write = true, realm_owner = true
    `);
  }

  let workerManagerStop = new Promise<void>((resolve) => {
    let stopHandler = (message: any) => {
      if (message === 'stopped') {
        workerManager.off('message', stopHandler);
        resolve();
      }
    };
    workerManager.on('message', stopHandler);
  });

  workerManager.send('stop');
  await workerManagerStop;

  // FIXME this is hideous
  workerManager = spawn('ts-node', workerArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  if (workerManager.stdout) {
    workerManager.stdout.on('data', (data: Buffer) =>
      console.log(`worker[${workerManagerPort}]: ${data.toString()}`),
    );
  }
  if (workerManager.stderr) {
    workerManager.stderr.on('data', (data: Buffer) =>
      console.error(`worker[${workerManagerPort}]: ${data.toString()}`),
    );
  }

  let newWorkerManagerStartupTimedOut = await Promise.race([
    new Promise<void>((resolve) => {
      let checkReady = async () => {
        try {
          let response = await fetch(`http://localhost:${workerManagerPort}/`);
          if (response.ok) {
            let json = await response.json();
            if (json.ready) {
              resolve();
              return;
            }
          }
        } catch (e) {}

        setTimeout(checkReady, 100);
      };

      checkReady();
    }),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), 30_000)),
  ]);

  if (newWorkerManagerStartupTimedOut) {
    throw new Error(`timed out waiting for restarted worker manager to start`);
  }

  // Add published realm database rows before starting realm server
  if (includePublishedRealm) {
    // Wait for worker manager startup to execute SQL
    let workerManagerStartupTimedOut = await Promise.race([
      new Promise<void>((resolve) => {
        let checkReady = async () => {
          try {
            let response = await fetch('http://localhost:4212/');
            if (response.ok) {
              let json = await response.json();
              if (json.ready) {
                resolve();
                return;
              }
            }
          } catch (e) {}

          setTimeout(checkReady, 100);
        };

        checkReady();
      }),
      new Promise<true>((resolve) => setTimeout(() => resolve(true), 30_000)),
    ]);

    if (workerManagerStartupTimedOut) {
      throw new Error(`timed out waiting for worker manager to start`);
    }

    let sqlExecutor = new WorkerManagerSQLExecutor(workerManager);

    await sqlExecutor.executeSQL(`
      INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
      VALUES (
        'http://published.realm/',
        '@node-test_realm:localhost',
        true,
        true,
        true
      ), (
        'http://published.realm/',
        '*',
        true,
        false,
        false
      )
    `);

    await sqlExecutor.executeSQL(`
      INSERT INTO published_realms (id, owner_username, source_realm_url, published_realm_url)
      VALUES (
        '${publishedRealmId}',
        '@node-test_realm:localhost',
        'http://example.com',
        'http://published.realm/'
      )
    `);
  }

  let serverArgs = [
    `--transpileOnly`,
    'main',
    `--port=${realmServerPort}`,
    `--matrixURL='${matrixURL}'`,
    `--realmsRootPath='${dir.name}'`,
    `--workerManagerPort=${workerManagerPort}`,
    `--useRegistrationSecretFunction`,

    `--path='${testRealmDir}'`,
    `--username='test_realm'`,
    `--fromUrl='http://localhost:${realmServerPort}/test/'`,
    `--toUrl='http://localhost:${realmServerPort}/test/'`,
  ];
  serverArgs = serverArgs.concat([
    `--username='skills_realm'`,
    `--path='${skillsRealmDir}'`,
    `--fromUrl='http://localhost:${realmServerPort}/skills/'`,
    `--toUrl='http://localhost:${realmServerPort}/skills/'`,
  ]);

  if (includePublishedRealm) {
    serverArgs = serverArgs.concat([
      `--fromUrl='http://published.realm/'`,
      `--toUrl='http://localhost:${realmServerPort}/published/'`,
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
      console.log(`realm server[${realmServerPort}]: ${data.toString()}`),
    );
  }
  if (realmServer.stderr) {
    realmServer.stderr.on('data', (data: Buffer) =>
      console.error(`realm server[${realmServerPort}]: ${data.toString()}`),
    );
  }
  realmServer.on('message', (message) => {
    if (message === 'get-registration-secret' && realmServer.send) {
      let registrationSecretFile = getRegistrationSecretFilename(synapsePort);

      try {
        let secret = readFileSync(registrationSecretFile, 'utf8');
        realmServer.send(`registration-secret:${secret}`);
      } catch (error) {
        console.error(
          `Failed to read registration secret from ${registrationSecretFile}:`,
          error,
        );
        // Fallback to default file if unique file doesn't exist
        try {
          let secret = readFileSync(
            join(matrixDir, 'registration_secret.txt'),
            'utf8',
          );
          realmServer.send(`registration-secret:${secret}`);
        } catch (fallbackError) {
          console.error(
            `Failed to read fallback registration secret:`,
            fallbackError,
          );
        }
      }
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

class WorkerManagerSQLExecutor {
  private workerManagerSqlResults: ((results: string) => void) | undefined;
  private workerManagerSqlError: ((error: string) => void) | undefined;

  constructor(private workerManagerProcess: ReturnType<typeof spawn>) {
    workerManagerProcess.on('message', (message) => {
      if (typeof message === 'string' && message.startsWith('sql-results:')) {
        let results = message.substring('sql-results:'.length);
        if (!this.workerManagerSqlResults) {
          console.error(`received unprompted worker manager SQL: ${results}`);
          return;
        }
        this.workerManagerSqlResults(results);
      } else if (
        typeof message === 'string' &&
        message.startsWith('sql-error:')
      ) {
        let error = message.substring('sql-error:'.length);
        if (!this.workerManagerSqlError) {
          console.error(
            `received unprompted worker manager SQL error: ${error}`,
          );
          return;
        }
        this.workerManagerSqlError(error);
      }
    });
  }

  async executeSQL(sql: string): Promise<Record<string, any>[]> {
    let execute = new Promise<string>(
      (resolve, reject: (reason: string) => void) => {
        this.workerManagerSqlResults = resolve;
        this.workerManagerSqlError = reject;
      },
    );
    this.workerManagerProcess.send(`execute-sql:${sql}`);
    let resultsStr = await execute;
    this.workerManagerSqlResults = undefined;
    this.workerManagerSqlError = undefined;
    return JSON.parse(resultsStr);
  }
}
