import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
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
  hostDir,
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

function boxelUIDistIsUsable(hostPackageDir: string): boolean {
  let boxelUIDistDir = join(hostPackageDir, '..', 'boxel-ui', 'addon', 'dist');
  return [
    join(boxelUIDistDir, 'components.js'),
    join(boxelUIDistDir, 'helpers.js'),
    join(boxelUIDistDir, 'icons.js'),
    join(boxelUIDistDir, 'styles', 'global.css'),
  ].every((path) => existsSync(path));
}

/**
 * Ensure boxel-ui dist artifacts exist for the host package. Tries in order:
 *   1. The current worktree's boxel-ui/addon/dist
 *   2. Symlink from the root repo's built boxel-ui dist (fast, avoids rebuild)
 *   3. Build boxel-ui in the current worktree (slow but always works)
 */
function ensureBoxelUIDist(hostPackageDir: string): void {
  if (boxelUIDistIsUsable(hostPackageDir)) {
    return;
  }

  let boxelUIAddonDir = join(hostPackageDir, '..', 'boxel-ui', 'addon');
  let boxelUIDistDir = join(boxelUIAddonDir, 'dist');

  // Try to symlink from root repo first (fast path for worktrees).
  let rootRepoCheckoutDir = findRootRepoCheckoutDir();
  if (rootRepoCheckoutDir && rootRepoCheckoutDir !== workspaceRoot) {
    let rootRepoBoxelUIDistDir = join(
      rootRepoCheckoutDir,
      'packages',
      'boxel-ui',
      'addon',
      'dist',
    );
    if (
      existsSync(join(rootRepoBoxelUIDistDir, 'components.js')) &&
      existsSync(join(rootRepoBoxelUIDistDir, 'helpers.js'))
    ) {
      supportLog.info(
        `symlinking boxel-ui dist from root repo: ${rootRepoBoxelUIDistDir} -> ${boxelUIDistDir}`,
      );
      let result = spawnSync(
        'ln',
        ['-sfn', rootRepoBoxelUIDistDir, boxelUIDistDir],
        {
          stdio: 'inherit',
        },
      );
      if (result.status === 0 && boxelUIDistIsUsable(hostPackageDir)) {
        return;
      }
    }
  }

  // Fall back to building boxel-ui.
  supportLog.info(`building boxel-ui dist at ${boxelUIAddonDir}...`);
  let result = spawnSync('pnpm', ['build'], {
    cwd: boxelUIAddonDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to build boxel-ui at ${boxelUIAddonDir} (exit code ${result.status}). ` +
        `Run \`cd ${boxelUIAddonDir} && pnpm build\` manually to diagnose.`,
    );
  }
  if (!boxelUIDistIsUsable(hostPackageDir)) {
    throw new Error(
      `boxel-ui build succeeded but dist is still incomplete at ${boxelUIDistDir}`,
    );
  }
}

/**
 * Build the host app dist when no pre-built dist is available anywhere.
 * Returns the host package directory where the dist was built.
 */
function buildHostDist(): string {
  // Prefer building in the current worktree so the output is local.
  let buildDir = hostDir;
  supportLog.info(
    `no pre-built host dist found — building host app at ${buildDir}...`,
  );
  let result = spawnSync('pnpm', ['build'], {
    cwd: buildDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to build host app at ${buildDir} (exit code ${result.status}). ` +
        `Run \`cd ${buildDir} && pnpm build\` manually to diagnose.`,
    );
  }
  let indexPath = join(buildDir, 'dist', 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(
      `Host build succeeded but dist/index.html is missing at ${buildDir}`,
    );
  }
  return buildDir;
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
        // No pre-built host dist found anywhere. Build it automatically so
        // cache:prepare works in a fresh worktree without manual setup.
        hostPackageDir = buildHostDist();
      }
      ensureBoxelUIDist(hostPackageDir);
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

/**
 * Ensure boxel-icons dist exists. In a worktree, symlink from the root repo
 * if available, otherwise build.
 */
function ensureBoxelIconsDist(): void {
  let distDir = join(boxelIconsDir, 'dist');
  if (
    existsSync(join(distDir, '@cardstack')) ||
    existsSync(join(distDir, 'index.html'))
  ) {
    return;
  }

  // Try to symlink from root repo (fast path for worktrees).
  let rootRepoCheckoutDir = findRootRepoCheckoutDir();
  if (rootRepoCheckoutDir && rootRepoCheckoutDir !== workspaceRoot) {
    let rootRepoIconsDistDir = join(
      rootRepoCheckoutDir,
      'packages',
      'boxel-icons',
      'dist',
    );
    if (existsSync(join(rootRepoIconsDistDir, '@cardstack'))) {
      supportLog.info(
        `symlinking boxel-icons dist from root repo: ${rootRepoIconsDistDir} -> ${distDir}`,
      );
      let result = spawnSync('ln', ['-sfn', rootRepoIconsDistDir, distDir], {
        stdio: 'inherit',
      });
      if (result.status === 0 && existsSync(join(distDir, '@cardstack'))) {
        return;
      }
    }
  }

  // Fall back to building boxel-icons.
  supportLog.info(`building boxel-icons dist at ${boxelIconsDir}...`);
  let result = spawnSync('pnpm', ['build'], {
    cwd: boxelIconsDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to build boxel-icons at ${boxelIconsDir} (exit code ${result.status}). ` +
        `Run \`cd ${boxelIconsDir} && pnpm build\` manually to diagnose.`,
    );
  }
}

function startIconServerProcess(): {
  child: ReturnType<typeof spawn>;
  logs: () => string;
  stop: () => Promise<void>;
} {
  let child = spawn('pnpm', ['serve'], {
    cwd: boxelIconsDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let captured = '';
  child.stdout?.on('data', (chunk) => {
    captured = `${captured}${String(chunk)}`.slice(-20_000);
  });
  child.stderr?.on('data', (chunk) => {
    captured = `${captured}${String(chunk)}`.slice(-20_000);
  });

  return {
    child,
    logs: () => captured,
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
}

async function ensureIconsReady(): Promise<{
  stop?: () => Promise<void>;
}> {
  return await logTimed(
    supportLog,
    `ensureIconsReady ${DEFAULT_ICONS_PROBE_URL}`,
    async () => {
      // Ensure boxel-icons dist exists before trying to serve it.
      ensureBoxelIconsDist();

      // Always start our own managed icon server so we control its lifecycle.
      // An externally-running server could die mid-indexing causing silent
      // render timeouts. If port 4206 is already taken by a healthy dev
      // server, our spawn will fail and we fall back to the existing one.
      let server = startIconServerProcess();

      try {
        await waitUntil(
          async () => {
            // If our process exited, either the port is already in use (dev
            // server running) or the start genuinely failed. Check if the
            // external server is healthy.
            if (server.child.exitCode !== null) {
              try {
                let response = await fetch(DEFAULT_ICONS_PROBE_URL);
                if (response.ok) {
                  supportLog.debug(
                    'icons server already available (external process)',
                  );
                  return true;
                }
              } catch {
                // fall through
              }
              throw new Error(
                `icons server exited early with code ${server.child.exitCode}\n${server.logs()}`,
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
            timeoutMessage: `Timed out waiting for icons server at ${DEFAULT_ICONS_PROBE_URL}\n${server.logs()}`,
          },
        );
      } catch (error) {
        await server.stop();
        throw error;
      }

      if (server.child.exitCode !== null) {
        // Our process couldn't start (port already taken by dev server).
        // Return without a stop function since we don't own the server.
        return {};
      }

      supportLog.debug('started managed icons server');
      return { stop: server.stop };
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
