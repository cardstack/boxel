#!/usr/bin/env tsx
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import http from 'http';
import * as path from 'path';
import { readFileSync } from 'fs';

export interface TestRealmServer {
  realmProcess: ChildProcess;
  workerProcess: ChildProcess;
  stop: () => Promise<void>;
}

export async function startTestRealmServer(
  realmPath: string,
  realmsRootPath: string,
): Promise<TestRealmServer> {
  const realmServerDir = path.join(__dirname, '..', '..', '..', 'realm-server');
  const matrixDir = path.join(__dirname, '..', '..', '..', 'matrix');
  let prerenderPort: number;

  // Use unique test database name like isolated-realm-server
  const testDbName = `test_db_${Math.floor(10000000 * Math.random())}`;

  const env = {
    ...process.env,
    PGHOST: 'localhost',
    PGPORT: '5435', // Test port, not 5432
    PGUSER: 'postgres',
    PGDATABASE: testDbName,
    REALM_SERVER_SECRET_SEED: "mum's the word",
    REALM_SECRET_SEED: "shhh! it's a secret",
    GRAFANA_SECRET: "shhh! it's a secret",
    MATRIX_URL: 'http://localhost:8008',
    REALM_SERVER_MATRIX_USERNAME: 'realm_server',
    NODE_ENV: 'test',
    NODE_NO_WARNINGS: '1',
  };

  // Minimal stub prerender server to satisfy required args without needing full prerender stack
  const prerenderServer = http.createServer((req, res) => {
    let isModule = req.url?.includes('prerender-module');
    let payload = isModule
      ? {
          id: 'test-module',
          status: 'ready',
          nonce: 'nonce',
          isShimmed: false,
          lastModified: Date.now(),
          createdAt: Date.now(),
          deps: [],
          definitions: {},
        }
      : {
          serialized: null,
          searchDoc: null,
          displayNames: null,
          deps: [],
          types: [],
          isolatedHTML: null,
          headHTML: null,
          atomHTML: null,
          embeddedHTML: {},
          fittedHTML: {},
          iconHTML: null,
        };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { attributes: payload } }));
  });
  // bind to an available port to avoid clashes with dev prerender or stale runs
  await new Promise<void>((resolve, reject) => {
    prerenderServer.on('error', reject);
    prerenderServer.listen(0, '127.0.0.1', () => {
      let address = prerenderServer.address();
      if (address && typeof address === 'object') {
        prerenderPort = address.port;
        resolve();
      } else {
        reject(new Error('Failed to determine prerender server port'));
      }
    });
  });

  // Start worker manager first
  const workerArgs = [
    '--transpileOnly',
    'worker-manager',
    '--port=4212',
    '--matrixURL=http://localhost:8008',
    `--distURL=${process.env.HOST_URL ?? 'http://localhost:4200'}`,
    `--prerendererUrl=http://localhost:${prerenderPort}`,
    '--migrateDB',
    '--fromUrl=http://localhost:4205/test/',
    '--toUrl=http://localhost:4205/test/',
    '--fromUrl=https://cardstack.com/base/',
    '--toUrl=http://localhost:4201/base/',
  ];

  const workerProcess = spawn('ts-node', workerArgs, {
    cwd: realmServerDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  workerProcess.on('error', (err) => {
    console.error(
      `[worker-error] failed to start worker-manager: ${err.message}`,
    );
  });

  if (workerProcess.stdout) {
    workerProcess.stdout.on('data', (data: Buffer) => {
      if (process.env.DEBUG) {
        console.log(`[worker] ${data.toString().trim()}`);
      }
    });
  }

  if (workerProcess.stderr) {
    workerProcess.stderr.on('data', (data: Buffer) => {
      console.error(`[worker-error] ${data.toString().trim()}`);
    });
  }

  // Now start realm server
  const serverArgs = [
    '--transpileOnly',
    'main',
    '--port=4205',
    '--matrixURL=http://localhost:8008',
    `--realmsRootPath=${realmsRootPath}`,
    '--workerManagerPort=4212',
    `--prerendererUrl=http://localhost:${prerenderPort}`,
    '--migrateDB',
    '--useRegistrationSecretFunction',
    `--path=${realmPath}`,
    '--username=test_realm',
    '--fromUrl=http://localhost:4205/test/',
    '--toUrl=http://localhost:4205/test/',
    '--fromUrl=https://cardstack.com/base/',
    '--toUrl=http://localhost:4201/base/',
  ];

  const realmProcess = spawn('ts-node', serverArgs, {
    cwd: realmServerDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  realmProcess.on('error', (err) => {
    console.error(
      `[realm-server-error] failed to start realm server: ${err.message}`,
    );
  });

  // Handle registration secret requests
  realmProcess.on('message', (message) => {
    if (message === 'get-registration-secret' && realmProcess.send) {
      try {
        const secret = readFileSync(
          path.join(matrixDir, 'registration_secret.txt'),
          'utf8',
        );
        realmProcess.send(`registration-secret:${secret}`);
      } catch (err) {
        console.error('Failed to read registration secret:', err);
        realmProcess.send(`registration-secret:registration`);
      }
    }
  });

  if (realmProcess.stdout) {
    realmProcess.stdout.on('data', (data: Buffer) => {
      const output = data.toString().trim();
      if (
        process.env.DEBUG ||
        output.includes('error') ||
        output.includes('Error')
      ) {
        console.log(`[realm-server] ${output}`);
      }
    });
  }

  if (realmProcess.stderr) {
    realmProcess.stderr.on('data', (data: Buffer) => {
      console.error(`[realm-server-error] ${data.toString().trim()}`);
    });
  }

  // Wait for ready message
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Realm server failed to start within 60 seconds'));
    }, 60000);

    const handleError = (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    };

    workerProcess.on('error', handleError);
    realmProcess.on('error', handleError);

    realmProcess.on('message', (message) => {
      if (message === 'ready') {
        clearTimeout(timeout);
        resolve();
      }
    });

    realmProcess.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Realm server exited with code ${code}`));
    });
  });

  // Create stop function
  const stop = async () => {
    const realmServerStopped = new Promise<void>((resolve) => {
      realmProcess.on('message', (message) => {
        if (message === 'stopped') {
          resolve();
        }
      });
    });

    const workerManagerStopped = new Promise<void>((resolve) => {
      workerProcess.on('message', (message) => {
        if (message === 'stopped') {
          resolve();
        }
      });
    });

    realmProcess.send('stop');
    await realmServerStopped;
    realmProcess.send('kill');

    workerProcess.send('stop');
    await workerManagerStopped;
    workerProcess.send('kill');

    await new Promise<void>((resolve) =>
      prerenderServer.close(() => resolve()),
    );
  };

  return { realmProcess, workerProcess, stop };
}

export async function waitForServer(
  url: string,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(
    `Server at ${url} failed to start after ${maxAttempts} attempts`,
  );
}
