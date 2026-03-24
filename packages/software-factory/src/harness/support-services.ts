import { spawn, type ChildProcess } from 'node:child_process';

import {
  boxelIconsDir,
  browserPassword,
  cleanupStaleSynapseContainers,
  DEFAULT_HOST_URL,
  DEFAULT_ICONS_PROBE_URL,
  DEFAULT_MATRIX_BROWSER_USERNAME,
  DEFAULT_MATRIX_SERVER_USERNAME,
  DEFAULT_PG_HOST,
  DEFAULT_PG_PORT,
  DEFAULT_PRERENDER_PORT,
  findAvailablePort,
  findHostDistPackageDir,
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

async function ensureHostReady(matrixURL: string): Promise<{
  stop?: () => Promise<void>;
}> {
  return await logTimed(
    supportLog,
    `ensureHostReady ${DEFAULT_HOST_URL}`,
    async () => {
      let response: Response;
      try {
        response = await fetch(DEFAULT_HOST_URL);
        if (response.ok) {
          return {};
        }
      } catch (error) {
        supportLog.debug(
          `host app not reachable at ${DEFAULT_HOST_URL}, starting fallback host service: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      let hostPackageDir = findHostDistPackageDir();
      let command = ['start'];
      let cwd = hostDir;
      if (hostPackageDir) {
        supportLog.debug(`serving built host dist from ${hostPackageDir}`);
        command = ['serve:dist'];
        cwd = hostPackageDir;
      } else {
        supportLog.warn(
          'no built host dist found; falling back to pnpm start in packages/host',
        );
      }

      let child = spawn('pnpm', command, {
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MATRIX_URL: matrixURL,
        },
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
              `host app exited early with code ${child.exitCode}\n${logs}`,
            );
          }
          try {
            let readyResponse = await fetch(DEFAULT_HOST_URL);
            return readyResponse.ok;
          } catch {
            return false;
          }
        },
        {
          timeout: 180_000,
          interval: 500,
          timeoutMessage: `Timed out waiting for host app at ${DEFAULT_HOST_URL}\n${logs}`,
        },
      );

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
  let silent = process.env.SOFTWARE_FACTORY_PRERENDER_SILENT !== '0';
  let child = spawn(
    'ts-node',
    [
      '--transpileOnly',
      'prerender/prerender-server',
      `--port=${port}`,
      ...(silent ? ['--silent'] : []),
    ],
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

    let synapse = await synapseStart(
      { suppressRegistrationSecretFile: true, dynamicHostPort: true },
      true,
    );
    let matrixURL =
      process.env.SOFTWARE_FACTORY_MATRIX_URL ?? getSynapseURL(synapse);
    let host = await ensureHostReady(matrixURL);
    let icons = await ensureIconsReady();
    await ensureSupportUsers(synapse);

    return {
      context: {
        matrixURL,
        matrixRegistrationSecret: synapse.registrationSecret,
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
