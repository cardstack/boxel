import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultSupportMetadataFile,
  sharedRuntimeDir,
} from './src/runtime-metadata.ts';

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const realmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'demo-realm',
);

function appendLog(buffer: string, chunk: string): string {
  let combined = `${buffer}${chunk}`;
  return combined.length > 20_000 ? combined.slice(-20_000) : combined;
}

async function waitForMetadataFile<T>(
  metadataFile: string,
  child: ReturnType<typeof spawn>,
  getLogs: () => string,
  timeoutMs = 120_000,
): Promise<T> {
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(metadataFile)) {
      return JSON.parse(readFileSync(metadataFile, 'utf8')) as T;
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

  let logs = '';
  let child = spawn('pnpm', ['serve:support', realmDir], {
    cwd: packageRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SOFTWARE_FACTORY_METADATA_FILE: defaultSupportMetadataFile,
      SOFTWARE_FACTORY_SUPPORT_METADATA_FILE: defaultSupportMetadataFile,
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
  }>(defaultSupportMetadataFile, child, () => logs);

  writeFileSync(
    defaultSupportMetadataFile,
    JSON.stringify(
      {
        ...payload,
        pid: child.pid,
      },
      null,
      2,
    ),
  );
}
