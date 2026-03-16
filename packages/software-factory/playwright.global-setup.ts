import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sharedRuntimeDir,
  writeSupportMetadata,
  getSupportMetadataFile,
} from './src/runtime-metadata.ts';

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const configuredRealmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'test-fixtures/darkfactory-adopter',
);
const fallbackRealmDir = resolve(
  packageRoot,
  'test-fixtures/darkfactory-adopter',
);
const testSourceRealmDir = resolve(
  packageRoot,
  'test-fixtures/public-software-factory-source',
);
const realmDir = existsSync(configuredRealmDir)
  ? configuredRealmDir
  : fallbackRealmDir;
const SETUP_COMMAND_TIMEOUT_MS = Number(
  process.env.SOFTWARE_FACTORY_SETUP_COMMAND_TIMEOUT_MS ?? 900_000,
);
const SUPPORT_METADATA_TIMEOUT_MS = Number(
  process.env.SOFTWARE_FACTORY_SUPPORT_METADATA_TIMEOUT_MS ?? 120_000,
);

function appendLog(buffer: string, chunk: string): string {
  let combined = `${buffer}${chunk}`;
  return combined.length > 20_000 ? combined.slice(-20_000) : combined;
}

async function waitForCommand(
  child: ReturnType<typeof spawn>,
  getLogs: () => string,
  timeoutMs = SETUP_COMMAND_TIMEOUT_MS,
): Promise<void> {
  let exit = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`command exited with code ${code ?? 'null'}\n${getLogs()}`),
        );
      }
    });
  });

  await Promise.race([
    exit,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `timed out waiting for setup command to finish\n${getLogs()}`,
            ),
          ),
        timeoutMs,
      ),
    ),
  ]);
}

async function waitForMetadataFile<T>(
  metadataFile: string,
  child: ReturnType<typeof spawn>,
  getLogs: () => string,
  timeoutMs = SUPPORT_METADATA_TIMEOUT_MS,
): Promise<T> {
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(metadataFile)) {
      try {
        return JSON.parse(readFileSync(metadataFile, 'utf8')) as T;
      } catch {
        // Retry until the writer finishes or timeout is reached.
      }
    }

    if (child.exitCode !== null) {
      throw new Error(
        `software-factory support exited early with code ${child.exitCode}\n${getLogs()}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `timed out waiting for software-factory support metadata ${metadataFile}\n${getLogs()}`,
  );
}

export default async function globalSetup() {
  rmSync(sharedRuntimeDir, { recursive: true, force: true });
  mkdirSync(sharedRuntimeDir, { recursive: true });
  let metadataFile = getSupportMetadataFile();

  let logs = '';
  let child = spawn('pnpm', ['serve:support', realmDir], {
    cwd: packageRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SOFTWARE_FACTORY_SUPPORT_METADATA_FILE: metadataFile,
      SOFTWARE_FACTORY_SOURCE_REALM_DIR: testSourceRealmDir,
    },
  });

  child.stdout?.on('data', (chunk) => {
    logs = appendLog(logs, String(chunk));
  });
  child.stderr?.on('data', (chunk) => {
    logs = appendLog(logs, String(chunk));
  });

  let payload = await waitForMetadataFile<{
    realmDir: string;
    context: Record<string, unknown>;
  }>(metadataFile, child, () => logs);

  let cacheLogs = '';
  let cacheChild = spawn('pnpm', ['cache:prepare', realmDir], {
    cwd: packageRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SOFTWARE_FACTORY_CONTEXT: JSON.stringify(payload.context),
      SOFTWARE_FACTORY_SOURCE_REALM_DIR: testSourceRealmDir,
    },
  });

  cacheChild.stdout?.on('data', (chunk) => {
    cacheLogs = appendLog(cacheLogs, String(chunk));
  });
  cacheChild.stderr?.on('data', (chunk) => {
    cacheLogs = appendLog(cacheLogs, String(chunk));
  });

  await waitForCommand(cacheChild, () => cacheLogs);

  writeSupportMetadata({
    ...payload,
    pid: child.pid,
  });
}
