import type { ChildProcess } from 'child_process';
import {
  createRegistrationToken,
  registerUser,
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';
import { registerRealmUsers, REGISTRATION_TOKEN } from '../helpers';
import { rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const stateFile = resolve(process.cwd(), '.test-services.json');
const REALM_STOP_TIMEOUT_MS = 15_000;

let synapse: SynapseInstance | undefined;
let realmServer: IsolatedRealmServer | undefined;
let shuttingDown = false;
let resolveKeepAlive: (() => void) | undefined;

function killProcessIfAlive(
  proc: ChildProcess | undefined,
  signal: NodeJS.Signals = 'SIGTERM',
) {
  if (!proc?.pid) {
    return;
  }
  try {
    process.kill(proc.pid, 0);
  } catch {
    return;
  }
  try {
    proc.kill(signal);
  } catch (err) {
    if (
      !(err instanceof Error) ||
      (err as NodeJS.ErrnoException).code !== 'ESRCH'
    ) {
      console.error(`failed to signal pid ${proc.pid} with ${signal}`, err);
    }
  }
}

async function stopRealmServerGracefully(timeoutMs = REALM_STOP_TIMEOUT_MS) {
  if (!realmServer) {
    return;
  }

  const realmProc = (
    realmServer as unknown as {
      realmServerProcess?: ChildProcess;
    }
  ).realmServerProcess;
  const workerProc = (
    realmServer as unknown as {
      workerManagerProcess?: ChildProcess;
    }
  ).workerManagerProcess;

  let completed = false;

  const stopPromise = realmServer
    .stop()
    .then(() => {
      completed = true;
    })
    .catch((err) => {
      completed = true;
      console.error('failed to stop isolated realm server', err);
    });

  await Promise.race([
    stopPromise,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!completed) {
          console.warn(
            `timed out after ${timeoutMs}ms waiting for isolated realm server to stop; forcing termination`,
          );
        }
        resolve();
      }, timeoutMs);
    }),
  ]);

  if (!completed) {
    killProcessIfAlive(workerProc, 'SIGTERM');
    killProcessIfAlive(realmProc, 'SIGTERM');
  }

  killProcessIfAlive(workerProc, 'SIGKILL');
  killProcessIfAlive(realmProc, 'SIGKILL');

  if (completed) {
    await stopPromise;
  }
}

async function shutdown(signal?: NodeJS.Signals | 'message') {
  console.log('Shutdown?');
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  const stopTasks: Promise<unknown>[] = [];

  if (realmServer) {
    stopTasks.push(stopRealmServerGracefully());
  }
  console.log('Is synapse there??!?!?!?!');
  if (synapse) {
    console.log('Stopping synapse instance...', synapse.synapseId);
    stopTasks.push(
      synapseStop(synapse.synapseId).catch((err) => {
        console.error('failed to stop synapse instance', err);
      }),
    );
  }

  await Promise.allSettled(stopTasks);

  realmServer = undefined;
  synapse = undefined;

  try {
    rmSync(stateFile, { force: true });
  } catch (err) {
    console.error(`failed to remove state file ${stateFile}`, err);
  }

  resolveKeepAlive?.();
  resolveKeepAlive = undefined;

  if (signal === 'SIGINT') {
    process.exitCode = 130;
  }
}

async function main() {
  let includePublished =
    process.argv.includes('--include-published') ||
    process.env.INCLUDE_PUBLISHED_REALM === 'true';

  try {
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await createRegistrationToken(admin.accessToken, REGISTRATION_TOKEN);
    realmServer = await startRealmServer(includePublished);

    writeFileSync(
      stateFile,
      JSON.stringify(
        {
          synapse,
          realmServerDb: realmServer.db,
          adminAccessToken: admin.accessToken,
        },
        null,
        2,
      ),
      'utf8',
    );

    ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].forEach((signal) => {
      process.once(signal, () => void shutdown(signal as NodeJS.Signals));
    });

    process.once('beforeExit', () => {
      void shutdown();
    });

    process.on('uncaughtException', (error) => {
      console.error('uncaught exception in test-services', error);
      void shutdown();
    });

    process.on('unhandledRejection', (reason) => {
      console.error('unhandled rejection in test-services', reason);
      void shutdown();
    });

    process.on('message', (message) => {
      if (message === 'stop') {
        void shutdown('message');
      }
    });

    await new Promise<void>((resolve) => {
      resolveKeepAlive = resolve;
    });
  } catch (err) {
    let error =
      err instanceof Error ? (err.stack ?? err.message) : JSON.stringify(err);
    process.send?.({
      type: 'error',
      error,
    });
    throw err;
  }
}

void main();
