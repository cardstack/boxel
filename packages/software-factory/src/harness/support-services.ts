import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  boxelIconsDir,
  browserPassword,
  cleanupStaleSynapseContainers,
  DEFAULT_ICONS_PROBE_URL,
  DEFAULT_MATRIX_BROWSER_USERNAME,
  DEFAULT_MATRIX_SERVER_USERNAME,
  DEFAULT_PG_HOST,
  DEFAULT_PG_PORT,
  DEFAULT_PRERENDER_PORT,
  CONFIGURED_HOST_URL,
  findAvailablePort,
  findHostDistPackageDir,
  findRootRepoCheckoutDir,
  logTimed,
  maybeRequire,
  prepareTestPgScript,
  realmServerDir,
  runCommand,
  supportLog,
  waitUntil,
  workspaceRoot,
  type FactorySupportContext,
  type SynapseInstance,
} from './shared';
import { canConnectToPg } from './database';

let preparePgPromise: Promise<void> | undefined;

function hostStartupLooksLikePortContention(logs: string): boolean {
  return /EADDRINUSE|address already in use/i.test(logs);
}

function assertUsableBoxelUIDist(hostPackageDir: string): void {
  let boxelUIAddonDir = join(hostPackageDir, '..', 'boxel-ui', 'addon');
  let boxelUIDistDir = join(boxelUIAddonDir, 'dist');
  let requiredPaths = [
    join(boxelUIDistDir, 'components.js'),
    join(boxelUIDistDir, 'helpers.js'),
    join(boxelUIDistDir, 'icons.js'),
    join(boxelUIDistDir, 'styles', 'global.css'),
  ];

  if (requiredPaths.every((path) => existsSync(path))) {
    return;
  }

  let rootRepoCheckoutDir = findRootRepoCheckoutDir();
  let rootRepoBoxelUIAddonDir =
    rootRepoCheckoutDir && rootRepoCheckoutDir !== workspaceRoot
      ? join(rootRepoCheckoutDir, 'packages', 'boxel-ui', 'addon')
      : undefined;
  let rootRepoBoxelUIDistDir = rootRepoBoxelUIAddonDir
    ? join(rootRepoBoxelUIAddonDir, 'dist')
    : undefined;
  let hasRootRepoBoxelUIDist =
    rootRepoBoxelUIDistDir != null &&
    requiredPaths
      .map((path) =>
        join(rootRepoBoxelUIDistDir, path.slice(boxelUIDistDir.length + 1)),
      )
      .every((path) => existsSync(path));

  let fixInstructions = [
    `Run \`cd ${boxelUIAddonDir} && mise exec -- pnpm build\` to build boxel-ui in this checkout.`,
  ];

  if (hasRootRepoBoxelUIDist && rootRepoBoxelUIDistDir) {
    fixInstructions.push(
      `If you are in a worktree and want to reuse the main checkout build, run \`ln -sfn ${rootRepoBoxelUIDistDir} ${boxelUIDistDir}\`.`,
    );
  }

  throw new Error(
    `Boxel UI dist is missing or incomplete at ${boxelUIDistDir}. The software-factory harness needs built @cardstack/boxel-ui artifacts before the host app can boot. ${fixInstructions.join(
      ' ',
    )}`,
  );
}

function assertUsableHostDist(hostPackageDir: string): void {
  let indexHTMLPath = join(hostPackageDir, 'dist', 'index.html');
  if (!existsSync(indexHTMLPath)) {
    throw new Error(
      `No built host dist was found at ${indexHTMLPath}. The software-factory harness requires a built host app from the current worktree or root repo checkout. Run \`cd ${hostPackageDir} && mise exec -- pnpm build\` and retry.`,
    );
  }

  let html = readFileSync(indexHTMLPath, 'utf8');
  let match = html.match(
    /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)">/,
  );
  if (!match) {
    return;
  }

  try {
    let config = JSON.parse(decodeURIComponent(match[1]));
    // Only reject Ember test builds where autoboot is explicitly disabled and
    // the rootElement is #ember-testing. Development and production builds are
    // both usable by the harness. This keeps worktree setups working without
    // requiring a full production build pipeline.
    if (
      config?.APP?.autoboot === false &&
      config?.APP?.rootElement === '#ember-testing'
    ) {
      throw new Error(
        `Host dist at ${hostPackageDir}/dist is an Ember test build and cannot power the software-factory harness (autoboot=${String(config?.APP?.autoboot)}, rootElement=${String(
          config?.APP?.rootElement,
        )}). The harness needs a normal host app build so /_standby can boot. Run \`cd ${hostPackageDir} && mise exec -- pnpm build\` and retry.`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
  }
}

async function loadSynapseModule() {
  let moduleSpecifier = '../../../matrix/docker/synapse/index.ts';
  return (maybeRequire(moduleSpecifier) ?? (await import(moduleSpecifier))) as {
    registerUser: (
      synapse: SynapseInstance,
      username: string,
      password: string,
      admin?: boolean,
      displayName?: string,
    ) => Promise<unknown>;
    synapseStart: (
      opts?: {
        suppressRegistrationSecretFile?: true;
        dynamicHostPort?: true;
      },
      stopExisting?: boolean,
    ) => Promise<SynapseInstance>;
    synapseStop: (id: string) => Promise<void>;
  };
}

async function loadMatrixEnvironmentConfigModule() {
  let moduleSpecifier = '../../../matrix/helpers/environment-config.ts';
  return (maybeRequire(moduleSpecifier) ?? (await import(moduleSpecifier))) as {
    getSynapseURL: (synapse?: { baseUrl?: string; port?: number }) => string;
  };
}

async function ensureHostReady(): Promise<{
  hostURL: string;
  stop?: () => Promise<void>;
}> {
  let configuredHostURL = CONFIGURED_HOST_URL?.href;
  return await logTimed(
    supportLog,
    `ensureHostReady ${configuredHostURL ?? 'dynamic host dist'}`,
    async () => {
      if (configuredHostURL) {
        try {
          let response = await fetch(configuredHostURL);
          if (response.ok) {
            return { hostURL: configuredHostURL };
          }
          throw new Error(
            `configured software-factory host URL ${configuredHostURL} returned HTTP ${response.status}`,
          );
        } catch (error) {
          throw new Error(
            `configured software-factory host URL ${configuredHostURL} is not reachable: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      let hostPackageDir = findHostDistPackageDir();
      if (!hostPackageDir) {
        throw new Error(
          'No built host dist is available in the current worktree or root repo checkout',
        );
      }
      assertUsableBoxelUIDist(hostPackageDir);
      assertUsableHostDist(hostPackageDir);
      let port = await findAvailablePort();
      let hostURL = `http://localhost:${port}/`;
      let hostDistDir = join(hostPackageDir, 'dist');
      let serveConfigPath = join(hostPackageDir, 'tests', 'serve.json');
      supportLog.debug(
        `serving built host dist from ${hostPackageDir} at ${hostURL}`,
      );

      let child = spawn(
        'npx',
        [
          'serve',
          '--config',
          serveConfigPath,
          '--single',
          '--cors',
          '--no-request-logging',
          '--no-etag',
          '--listen',
          String(port),
          hostDistDir,
        ],
        {
          cwd: hostPackageDir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        },
      );

      let logs = '';
      child.stdout?.on('data', (chunk) => {
        logs = `${logs}${String(chunk)}`.slice(-20_000);
      });
      child.stderr?.on('data', (chunk) => {
        logs = `${logs}${String(chunk)}`.slice(-20_000);
      });

      await waitUntil(
        async () => {
          try {
            let readyResponse = await fetch(hostURL);
            if (readyResponse.ok) {
              return true;
            }
          } catch {
            // host not ready yet
          }
          if (child.exitCode !== null) {
            if (hostStartupLooksLikePortContention(logs)) {
              return false;
            }
            throw new Error(
              `host app exited early with code ${child.exitCode}\n${logs}`,
            );
          }
          return false;
        },
        {
          timeout: 180_000,
          interval: 500,
          timeoutMessage: `Timed out waiting for host app at ${hostURL}\n${logs}`,
        },
      );

      return {
        hostURL,
        async stop() {
          if (child.exitCode === null) {
            try {
              process.kill(-child.pid!, 'SIGTERM');
            } catch {
              // best effort cleanup
            }
          }
        },
      };
    },
  );
}

async function waitForHttpReady(url: string, timeoutMs = 60_000) {
  let startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url} to become ready`);
}

async function stopChildProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGINT',
): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      child.removeAllListeners('exit');
      child.removeAllListeners('error');
    };

    child.once('exit', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });
    child.once('error', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });

    timeout = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
      }
    }, 5_000);

    child.kill(signal);
  });
}

export async function startHarnessPrerenderServer(options: {
  boxelHostURL: string;
  port?: number;
}): Promise<{
  url: string;
  stop(): Promise<void>;
}> {
  let port = options.port ?? DEFAULT_PRERENDER_PORT;
  if (port === 0) {
    port = await findAvailablePort();
  }
  let url = `http://localhost:${port}`;
  let child = spawn(
    'ts-node',
    ['--transpileOnly', 'prerender/prerender-server', `--port=${port}`],
    {
      cwd: realmServerDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'development',
        NODE_NO_WARNINGS: '1',
        BOXEL_HOST_URL: options.boxelHostURL,
        LOG_LEVELS:
          process.env.SOFTWARE_FACTORY_PRERENDER_LOG_LEVELS ??
          process.env.LOG_LEVELS,
      },
    },
  );

  child.stdout?.on('data', (data: Buffer) => {
    console.log(`prerender: ${data.toString()}`);
  });
  child.stderr?.on('data', (data: Buffer) => {
    console.error(`prerender: ${data.toString()}`);
  });

  let exitPromise = new Promise<never>((_, reject) => {
    child.once('exit', (code, signal) => {
      reject(
        new Error(
          `prerender server exited before it became ready (code: ${code}, signal: ${signal})`,
        ),
      );
    });
    child.once('error', reject);
  });

  await Promise.race([waitForHttpReady(url), exitPromise]);

  return {
    url,
    async stop() {
      await stopChildProcess(child);
    },
  };
}

async function ensureIconsReady(): Promise<{
  stop?: () => Promise<void>;
}> {
  return await logTimed(
    supportLog,
    `ensureIconsReady ${DEFAULT_ICONS_PROBE_URL}`,
    async () => {
      try {
        let response = await fetch(DEFAULT_ICONS_PROBE_URL);
        if (response.ok) {
          supportLog.debug('icons server already available');
          return {};
        }
      } catch {
        // fall through and start the local icon server
      }

      let child = spawn('pnpm', ['serve'], {
        cwd: boxelIconsDir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let logs = '';
      child.stdout?.on('data', (chunk) => {
        logs = `${logs}${String(chunk)}`.slice(-20_000);
      });
      child.stderr?.on('data', (chunk) => {
        logs = `${logs}${String(chunk)}`.slice(-20_000);
      });

      await waitUntil(
        async () => {
          if (child.exitCode !== null) {
            throw new Error(
              `icons server exited early with code ${child.exitCode}\n${logs}`,
            );
          }
          try {
            let response = await fetch(DEFAULT_ICONS_PROBE_URL);
            return response.ok;
          } catch {
            return false;
          }
        },
        {
          timeout: 30_000,
          interval: 250,
          timeoutMessage: `Timed out waiting for icons server at ${DEFAULT_ICONS_PROBE_URL}\n${logs}`,
        },
      );

      supportLog.debug('started local icons server');
      return {
        async stop() {
          if (child.exitCode === null) {
            try {
              process.kill(-child.pid!, 'SIGTERM');
            } catch {
              // best effort cleanup
            }
          }
        },
      };
    },
  );
}

async function ensurePgReady(): Promise<void> {
  if (!preparePgPromise) {
    preparePgPromise = logTimed(
      supportLog,
      `ensurePgReady ${DEFAULT_PG_HOST}:${DEFAULT_PG_PORT}`,
      async () => {
        if (await canConnectToPg()) {
          supportLog.debug('postgres already available');
          return;
        }
        runCommand('bash', [prepareTestPgScript], workspaceRoot);
        await waitUntil(() => canConnectToPg(), {
          timeout: 30_000,
          interval: 250,
          timeoutMessage: `Timed out waiting for Postgres on ${DEFAULT_PG_HOST}:${DEFAULT_PG_PORT}`,
        });
      },
    ).catch((error) => {
      preparePgPromise = undefined;
      throw error;
    });
  }

  await preparePgPromise;
}

async function ensureSupportUsers(synapse: SynapseInstance): Promise<void> {
  await logTimed(supportLog, 'ensureSupportUsers', async () => {
    let { registerUser } = await loadSynapseModule();

    await registerUser(
      synapse,
      DEFAULT_MATRIX_SERVER_USERNAME,
      browserPassword(DEFAULT_MATRIX_SERVER_USERNAME),
    );
    await registerUser(
      synapse,
      DEFAULT_MATRIX_BROWSER_USERNAME,
      browserPassword(DEFAULT_MATRIX_BROWSER_USERNAME),
    );
  });
}

export async function startFactorySupportServices(): Promise<{
  context: FactorySupportContext;
  stop(): Promise<void>;
}> {
  return await logTimed(supportLog, 'startFactorySupportServices', async () => {
    await ensurePgReady();
    cleanupStaleSynapseContainers();
    let { synapseStart, synapseStop } = await loadSynapseModule();
    let { getSynapseURL } = await loadMatrixEnvironmentConfigModule();

    // stopExisting: false — the test harness uses a dynamic port, so it
    // doesn't conflict with the dev Synapse (boxel-synapse on port 8008).
    // Stopping existing containers kills the dev environment.
    let synapse = await synapseStart(
      { suppressRegistrationSecretFile: true, dynamicHostPort: true },
      false,
    );
    let matrixURL =
      process.env.SOFTWARE_FACTORY_MATRIX_URL ?? getSynapseURL(synapse);
    let host = await ensureHostReady();
    let icons = await ensureIconsReady();
    await ensureSupportUsers(synapse);

    return {
      context: {
        matrixURL,
        matrixRegistrationSecret: synapse.registrationSecret,
        hostURL: host.hostURL,
      },
      async stop() {
        await logTimed(supportLog, 'stopFactorySupportServices', async () => {
          await synapseStop(synapse.synapseId);
          await host.stop?.();
          await icons.stop?.();
        });
      },
    };
  });
}
