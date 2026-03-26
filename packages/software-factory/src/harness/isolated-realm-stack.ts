import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import fsExtra from 'fs-extra';
import { spawn } from 'node:child_process';

import {
  baseRealmDir,
  baseRealmURLFor,
  captureProcessLogs,
  CONFIGURED_PRERENDER_URL,
  createProcessExitPromise,
  DEFAULT_MATRIX_SERVER_USERNAME,
  DEFAULT_PG_HOST,
  DEFAULT_PG_POOL_MAX,
  DEFAULT_PG_PORT,
  DEFAULT_PG_USER,
  DEFAULT_REALM_LOG_LEVELS,
  DEFAULT_REALM_SERVER_PORT,
  DEFAULT_WORKER_MANAGER_PORT,
  findAvailablePort,
  FIXTURE_SOURCE_REALM_URL_PLACEHOLDER,
  FULL_INDEX_REALM_STARTUP_TIMEOUT_MS,
  INCLUDE_SKILLS,
  managedProcessStdio,
  realmLog,
  realmRelativePath,
  realmServerDir,
  realmURLWithinServer,
  REALM_SECRET_SEED,
  REALM_SERVER_SECRET_SEED,
  shouldIgnoreFixturePath,
  skillsRealmDir,
  skillsRealmURLFor,
  sourceRealmDir,
  sourceRealmURLFor,
  GRAFANA_SECRET,
  waitForJsonFile,
  waitForReady,
  withPort,
  DEFAULT_REALM_STARTUP_TIMEOUT_MS,
  stopManagedProcess,
  type FactorySupportContext,
  type RunningFactoryStack,
  type SpawnedProcess,
  type StartedCompatRealmProxy,
} from './shared';
import { startHarnessPrerenderServer } from './support-services';

const { copySync, ensureDirSync } = fsExtra;

async function readIncomingRequestBody(
  req: IncomingMessage,
): Promise<Buffer | undefined> {
  let chunks: Buffer[] = [];
  for await (let chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function describeCompatProxyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  let parts: string[] = [];
  let current: unknown = error;

  while (current) {
    if (current instanceof Error) {
      let code =
        'code' in current && typeof current.code === 'string'
          ? ` (${current.code})`
          : '';
      parts.push(`${current.message}${code}`);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }

  return parts.join(' <- ');
}

async function startCompatRealmProxy({
  listenPort,
}: {
  listenPort: number;
}): Promise<StartedCompatRealmProxy> {
  realmLog.debug(`startCompatRealmProxy: requested listenPort=${listenPort}`);
  let targetPort: number | undefined;
  let actualListenPort = listenPort;
  let server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (targetPort == null) {
        res.statusCode = 503;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('software-factory compat proxy target is not ready');
        return;
      }
      let incomingURL = new URL(
        req.url ?? '/',
        `${
          req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
        }://${req.headers.host ?? `127.0.0.1:${actualListenPort}`}`,
      );
      let upstreamURL = new URL(
        `${incomingURL.pathname}${incomingURL.search}`,
        `http://localhost:${targetPort}`,
      );

      try {
        let body = await readIncomingRequestBody(req);
        let headers = Object.fromEntries(
          Object.entries(req.headers).filter(
            ([key]) => key.toLowerCase() !== 'host',
          ),
        ) as Record<string, string>;
        headers['x-boxel-forwarded-url'] = incomingURL.href;
        let response = await fetch(upstreamURL, {
          method: req.method,
          headers,
          body: body as BodyInit | undefined,
          redirect: 'manual',
        });

        let responseHeaders = new Headers(response.headers);
        let location = responseHeaders.get('location');
        if (location) {
          responseHeaders.set(
            'location',
            location
              .replace(
                `http://localhost:${targetPort}/`,
                `http://127.0.0.1:${listenPort}/`,
              )
              .replace(
                `http://localhost:${targetPort}/`,
                `http://localhost:${listenPort}/`,
              ),
          );
        }

        res.statusCode = response.status;
        responseHeaders.forEach((value, key) => {
          res.setHeader(key, value);
        });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        let description = describeCompatProxyError(error);
        realmLog.warn(
          `startCompatRealmProxy: upstream fetch failed for ${upstreamURL.href}: ${description}`,
        );
        res.statusCode = 502;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(
          `software-factory compat proxy failed for ${upstreamURL.href}: ${description}`,
        );
      }
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolve());
  });
  let address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine compat proxy port');
  }
  actualListenPort = address.port;
  realmLog.debug(`startCompatRealmProxy: listening on ${actualListenPort}`);
  return {
    listenPort: actualListenPort,
    setTargetPort(nextTargetPort: number) {
      targetPort = nextTargetPort;
      realmLog.debug(
        `startCompatRealmProxy: ${actualListenPort} -> ${nextTargetPort} ready`,
      );
    },
    async stop() {
      realmLog.debug(
        `startCompatRealmProxy: ${actualListenPort} -> ${targetPort ?? 'unset'} stopping`,
      );
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

function rewriteFixtureSourceModuleUrls(
  destination: string,
  sourceRealmURL: URL,
): void {
  let rewrittenFiles = 0;

  function visit(currentDir: string) {
    for (let entry of readdirSync(currentDir, { withFileTypes: true })) {
      let absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      let contents = readFileSync(absolutePath, 'utf8');
      if (!contents.includes(FIXTURE_SOURCE_REALM_URL_PLACEHOLDER)) {
        continue;
      }

      writeFileSync(
        absolutePath,
        contents
          .split(FIXTURE_SOURCE_REALM_URL_PLACEHOLDER)
          .join(sourceRealmURL.href),
      );
      rewrittenFiles++;
    }
  }

  visit(destination);
  if (rewrittenFiles > 0) {
    realmLog.debug(
      `rewriteFixtureSourceModuleUrls: rewrote ${rewrittenFiles} files to ${sourceRealmURL.href}`,
    );
  }
}

function copyRealmFixture(
  realmDir: string,
  destination: string,
  sourceRealmURL: URL,
): void {
  copySync(realmDir, destination, {
    preserveTimestamps: true,
    filter(src) {
      let relativePath = relative(realmDir, src).replace(/\\/g, '/');
      return relativePath === '' || !shouldIgnoreFixturePath(relativePath);
    },
  });
  rewriteFixtureSourceModuleUrls(destination, sourceRealmURL);
}

export async function startIsolatedRealmStack({
  realmDir,
  realmURL,
  realmServerURL,
  databaseName,
  context,
  migrateDB,
  fullIndexOnStartup,
}: {
  realmDir: string;
  realmURL: URL;
  realmServerURL: URL;
  databaseName: string;
  context: FactorySupportContext;
  migrateDB: boolean;
  fullIndexOnStartup: boolean;
}): Promise<RunningFactoryStack> {
  let rootDir = mkdtempSync(join(tmpdir(), 'software-factory-realms-'));
  let testRealmDir = join(rootDir, 'test');
  let workerManagerMetadataFile = join(rootDir, 'worker-manager.runtime.json');
  let realmServerMetadataFile = join(rootDir, 'realm-server.runtime.json');
  let actualRealmServerPort =
    DEFAULT_REALM_SERVER_PORT === 0
      ? await findAvailablePort()
      : DEFAULT_REALM_SERVER_PORT;
  let actualRealmServerURL = withPort(realmServerURL, actualRealmServerPort);
  let actualRealmPath = realmRelativePath(realmURL, realmServerURL);
  let actualRealmURL = realmURLWithinServer(
    actualRealmServerURL,
    actualRealmPath,
  );
  let legacyRealmServerURL = new URL('http://localhost:4205/');
  let legacyRealmURL = new URL('test/', legacyRealmServerURL);
  let publicBaseRealmURL = baseRealmURLFor(realmServerURL);
  let actualBaseRealmURL = baseRealmURLFor(actualRealmServerURL);
  let sourceRealmURL = sourceRealmURLFor(realmServerURL);
  let actualSourceRealmURL = sourceRealmURLFor(actualRealmServerURL);
  let legacySourceRealmURL = sourceRealmURLFor(legacyRealmServerURL);
  let skillsRealmURL = skillsRealmURLFor(realmServerURL);
  let actualSkillsRealmURL = skillsRealmURLFor(actualRealmServerURL);
  let legacySkillsRealmURL = skillsRealmURLFor(legacyRealmServerURL);
  ensureDirSync(testRealmDir);
  copyRealmFixture(realmDir, testRealmDir, sourceRealmURL);
  realmLog.debug(
    `startIsolatedRealmStack: copied fixture ${realmDir} -> ${testRealmDir}`,
  );
  let compatProxy = await startCompatRealmProxy({
    listenPort: Number(realmServerURL.port),
  });
  // The software-factory Playwright harness can keep prerender alive for the
  // lifetime of a Playwright testWorker even though the realm stack itself is
  // recreated per test. When provided, reuse that long-lived prerender URL so
  // we only restart realm-server and worker-manager here.
  let prerender = CONFIGURED_PRERENDER_URL
    ? undefined
    : await startHarnessPrerenderServer({
        boxelHostURL: realmServerURL.href.replace(/\/$/, ''),
      });
  let prerenderURL = CONFIGURED_PRERENDER_URL?.href ?? prerender?.url;
  if (!prerenderURL) {
    throw new Error(
      'Unable to determine prerender URL for isolated realm stack',
    );
  }

  let env = {
    ...process.env,
    PGHOST: DEFAULT_PG_HOST,
    PGPORT: DEFAULT_PG_PORT,
    PGUSER: DEFAULT_PG_USER,
    PG_POOL_MAX: String(DEFAULT_PG_POOL_MAX),
    PGDATABASE: databaseName,
    NODE_NO_WARNINGS: '1',
    NODE_ENV: 'test',
    REALM_SERVER_SECRET_SEED,
    REALM_SECRET_SEED,
    GRAFANA_SECRET,
    HOST_URL: context.hostURL,
    MATRIX_URL: context.matrixURL,
    MATRIX_SERVER_NAME: new URL(context.matrixURL).hostname,
    MATRIX_REGISTRATION_SHARED_SECRET: context.matrixRegistrationSecret,
    REALM_SERVER_MATRIX_USERNAME: DEFAULT_MATRIX_SERVER_USERNAME,
    REALM_SERVER_FULL_INDEX_ON_STARTUP: String(fullIndexOnStartup),
    LOW_CREDIT_THRESHOLD: '2000',
    LOG_LEVELS: DEFAULT_REALM_LOG_LEVELS,
    BOXEL_TRUST_FORWARDED_URL: 'true',
    PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: `localhost:${compatProxy.listenPort}`,
    PUBLISHED_REALM_BOXEL_SITE_DOMAIN: `localhost:${compatProxy.listenPort}`,
    SOFTWARE_FACTORY_WORKER_MANAGER_METADATA_FILE: workerManagerMetadataFile,
    SOFTWARE_FACTORY_REALM_SERVER_METADATA_FILE: realmServerMetadataFile,
  };

  let workerArgs = [
    '--transpileOnly',
    'worker-manager',
    `--port=${DEFAULT_WORKER_MANAGER_PORT}`,
    `--matrixURL=${context.matrixURL}`,
    `--prerendererUrl=${prerenderURL}`,
    `--fromUrl=${realmURL.href}`,
    `--toUrl=${actualRealmURL.href}`,
    `--fromUrl=${publicBaseRealmURL.href}`,
    `--toUrl=${actualBaseRealmURL.href}`,
    '--fromUrl=https://cardstack.com/base/',
    `--toUrl=${publicBaseRealmURL.href}`,
    `--fromUrl=${sourceRealmURL.href}`,
    `--toUrl=${actualSourceRealmURL.href}`,
  ];
  if (INCLUDE_SKILLS) {
    workerArgs.push(
      `--fromUrl=${skillsRealmURL.href}`,
      `--toUrl=${actualSkillsRealmURL.href}`,
    );
  }
  workerArgs.push(
    `--fromUrl=${legacyRealmURL.href}`,
    `--toUrl=${actualRealmURL.href}`,
    `--fromUrl=${legacySourceRealmURL.href}`,
    `--toUrl=${actualSourceRealmURL.href}`,
  );
  if (INCLUDE_SKILLS) {
    workerArgs.push(
      `--fromUrl=${legacySkillsRealmURL.href}`,
      `--toUrl=${actualSkillsRealmURL.href}`,
    );
  }
  if (migrateDB) {
    workerArgs.splice(5, 0, '--migrateDB');
  }

  let workerManager = spawn('ts-node', workerArgs, {
    cwd: realmServerDir,
    env,
    stdio: managedProcessStdio,
  }) as SpawnedProcess;
  let getWorkerLogs = captureProcessLogs(workerManager);
  workerManager.on('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      return;
    }
    realmLog.warn(
      `worker manager exited unexpectedly (code: ${code}, signal: ${signal})\n${getWorkerLogs()}`,
    );
  });
  let workerManagerRuntime = await waitForJsonFile<{
    pid: number;
    port: number;
    url: string;
  }>(workerManagerMetadataFile, getWorkerLogs, {
    label: 'worker manager',
    process: workerManager,
  });

  let serverArgs = [
    '--transpileOnly',
    'main',
    `--port=${actualRealmServerPort}`,
    `--serverURL=${realmServerURL.href}`,
    `--matrixURL=${context.matrixURL}`,
    `--realmsRootPath=${rootDir}`,
    `--workerManagerUrl=${workerManagerRuntime.url}`,
    `--prerendererUrl=${prerenderURL}`,
    '--username=base_realm',
    `--path=${baseRealmDir}`,
    `--fromUrl=${publicBaseRealmURL.href}`,
    `--toUrl=${actualBaseRealmURL.href}`,
    '--username=software_factory_realm',
    `--path=${sourceRealmDir}`,
    `--fromUrl=${sourceRealmURL.href}`,
    `--toUrl=${actualSourceRealmURL.href}`,
    '--username=test_realm',
    `--path=${testRealmDir}`,
    `--fromUrl=${realmURL.href}`,
    `--toUrl=${actualRealmURL.href}`,
  ];
  if (INCLUDE_SKILLS) {
    serverArgs.splice(
      16,
      0,
      '--username=skills_realm',
      `--path=${skillsRealmDir}`,
      `--fromUrl=${skillsRealmURL.href}`,
      `--toUrl=${actualSkillsRealmURL.href}`,
    );
  }
  serverArgs.push(
    `--fromUrl=${legacyRealmURL.href}`,
    `--toUrl=${actualRealmURL.href}`,
    `--fromUrl=${legacySourceRealmURL.href}`,
    `--toUrl=${actualSourceRealmURL.href}`,
  );
  if (INCLUDE_SKILLS) {
    serverArgs.push(
      `--fromUrl=${legacySkillsRealmURL.href}`,
      `--toUrl=${actualSkillsRealmURL.href}`,
    );
  }

  let realmServer = spawn('ts-node', serverArgs, {
    cwd: realmServerDir,
    env,
    stdio: managedProcessStdio,
  }) as SpawnedProcess;
  let getServerLogs = captureProcessLogs(realmServer);
  realmServer.on('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      return;
    }
    realmLog.warn(
      `realm server exited unexpectedly (code: ${code}, signal: ${signal})\n${getServerLogs()}`,
    );
  });

  try {
    let realmServerRuntime = await waitForJsonFile<{
      pid: number;
      port: number;
    }>(realmServerMetadataFile, getServerLogs, {
      label: 'realm server',
      process: realmServer,
    });
    compatProxy.setTargetPort(realmServerRuntime.port);
    await Promise.race([
      waitForReady(
        realmServer,
        'realm server',
        fullIndexOnStartup
          ? FULL_INDEX_REALM_STARTUP_TIMEOUT_MS
          : DEFAULT_REALM_STARTUP_TIMEOUT_MS,
        () =>
          [
            'realm server logs:',
            getServerLogs(),
            'worker manager logs:',
            getWorkerLogs(),
          ]
            .filter((entry) => entry && entry.trim().length > 0)
            .join('\n\n'),
      ),
      createProcessExitPromise(workerManager, 'worker manager'),
    ]);

    return {
      compatProxy,
      prerender,
      realmServer,
      realmServerURL,
      ports: {
        publicPort: compatProxy.listenPort,
        realmServerPort: realmServerRuntime.port,
        workerManagerPort: workerManagerRuntime.port,
      },
      workerManager,
      rootDir,
    };
  } catch (error) {
    try {
      await prerender?.stop();
    } catch {
      // best effort cleanup
    }
    try {
      await stopManagedProcess(realmServer);
    } catch {
      // best effort cleanup
    }
    try {
      await stopManagedProcess(workerManager);
    } catch {
      // best effort cleanup
    }
    try {
      await compatProxy?.stop();
    } catch {
      // best effort cleanup
    }
    rmSync(rootDir, { recursive: true, force: true });
    throw error;
  }
}

export async function stopIsolatedRealmStack(
  stack: RunningFactoryStack,
): Promise<void> {
  let cleanupError: unknown;

  try {
    await stack.prerender?.stop();
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await stopManagedProcess(stack.realmServer);
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await stopManagedProcess(stack.workerManager);
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await stack.compatProxy?.stop();
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    rmSync(stack.rootDir, { recursive: true, force: true });
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError) {
    throw cleanupError;
  }
}
