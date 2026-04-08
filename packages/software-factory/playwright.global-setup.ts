import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import './src/setup-logger';
import { logger } from './src/logger';
import {
  sharedRuntimeDir,
  writeSupportMetadata,
  getSupportMetadataFile,
  type PreparedTemplateMetadata,
} from './src/runtime-metadata';

const packageRoot = resolve(__dirname);
const tsNodeBin = resolve(packageRoot, 'node_modules', '.bin', 'ts-node');
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
const bootstrapTargetRealmDir = resolve(
  packageRoot,
  'test-fixtures/bootstrap-target',
);
const testRealmRunnerDir = resolve(
  packageRoot,
  'test-fixtures/test-realm-runner',
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

const setupLog = logger('software-factory:playwright');
const supportLog = logger('software-factory:playwright:support');
const cacheLog = logger('software-factory:playwright:cache');

function appendLog(buffer: string, chunk: string): string {
  let combined = `${buffer}${chunk}`;
  return combined.length > 20_000 ? combined.slice(-20_000) : combined;
}

function prefixChunk(label: string, chunk: string): string {
  let trimmed = chunk.replace(/\s+$/, '');
  if (!trimmed) {
    return '';
  }

  return trimmed
    .split('\n')
    .map((line) => `[${label}] ${line}`)
    .join('\n');
}

function maybeLogCacheProgress(
  log: ReturnType<typeof logger>,
  chunk: string,
): void {
  let trimmed = chunk.replace(/\s+$/, '');
  if (!trimmed) {
    return;
  }

  for (let line of trimmed.split('\n')) {
    if (
      /\b(begin visiting file|completed visiting file|starting from-scratch indexing|completed from scratch indexing|starting indexing|has completed indexing)\b/.test(
        line,
      )
    ) {
      log.info(line);
      continue;
    }

    if (
      /encountered error indexing|Render timed-out|missing file /.test(line)
    ) {
      log.warn(line);
    }
  }
}

function mirrorChildOutput(
  child: ReturnType<typeof spawn>,
  log: ReturnType<typeof logger>,
  setLogs: (next: string) => void,
  getLogs: () => string,
): void {
  child.stdout?.on('data', (chunk) => {
    let text = String(chunk);
    setLogs(appendLog(getLogs(), text));
    let prefixed = prefixChunk('child', text);
    if (prefixed) {
      for (let line of prefixed.split('\n')) {
        log.debug(line);
      }
    }
  });

  child.stderr?.on('data', (chunk) => {
    let text = String(chunk);
    setLogs(appendLog(getLogs(), text));
    let prefixed = prefixChunk('child', text);
    if (prefixed) {
      for (let line of prefixed.split('\n')) {
        log.debug(line);
      }
    }
  });
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

async function prepareTemplatesForRealms(
  realmDirs: string[],
  context: Record<string, unknown>,
  metadataFile: string,
): Promise<PreparedTemplateMetadata[]> {
  let cacheLogs = '';
  setupLog.warn(
    `starting cache:prepare for ${realmDirs.length} realm(s); this can take a while on cold startup or in CI`,
  );
  let cacheChild = spawn('pnpm', ['cache:prepare', ...realmDirs], {
    cwd: packageRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SOFTWARE_FACTORY_CONTEXT: JSON.stringify(context),
      SOFTWARE_FACTORY_METADATA_FILE: metadataFile,
      SOFTWARE_FACTORY_SOURCE_REALM_DIR: testSourceRealmDir,
    },
  });

  mirrorChildOutput(
    cacheChild,
    cacheLog,
    (next) => {
      cacheLogs = next;
    },
    () => cacheLogs,
  );
  cacheChild.stdout?.on('data', (chunk) => {
    maybeLogCacheProgress(cacheLog, String(chunk));
  });
  cacheChild.stderr?.on('data', (chunk) => {
    maybeLogCacheProgress(cacheLog, String(chunk));
  });

  let cacheStartedAt = Date.now();
  await waitForCommand(cacheChild, () => cacheLogs);
  let cachePayload = await waitForMetadataFile<{
    preparedTemplates?: PreparedTemplateMetadata[];
  }>(metadataFile, cacheChild, () => cacheLogs, 5_000);
  setupLog.info(
    `cache:prepare finished for ${realmDirs.length} realm(s) in ${(
      (Date.now() - cacheStartedAt) /
      1000
    ).toFixed(1)}s`,
  );

  if (!cachePayload.preparedTemplates?.length) {
    throw new Error(
      `cache:prepare did not return preparedTemplates for ${realmDirs.join(', ')}`,
    );
  }

  for (let template of cachePayload.preparedTemplates) {
    let realmLabel = template.realmDir.replace(`${packageRoot}/`, '');
    if (template.cacheHit) {
      setupLog.info(
        `cache hit for ${realmLabel} -> ${template.templateDatabaseName}`,
      );
    } else {
      setupLog.warn(
        `cache miss for ${realmLabel} -> ${template.templateDatabaseName}: ${
          template.cacheMissReason ?? 'unknown reason'
        }`,
      );
    }
  }

  return cachePayload.preparedTemplates;
}

export default async function globalSetup() {
  let setupStartedAt = Date.now();
  rmSync(sharedRuntimeDir, { recursive: true, force: true });
  mkdirSync(sharedRuntimeDir, { recursive: true });
  let metadataFile = getSupportMetadataFile();

  supportLog.debug(`starting serve:support for realm ${realmDir}`);
  let logs = '';
  let child = spawn(
    tsNodeBin,
    ['--transpileOnly', 'src/cli/serve-support.ts', realmDir],
    {
      cwd: packageRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        SOFTWARE_FACTORY_SUPPORT_METADATA_FILE: metadataFile,
        SOFTWARE_FACTORY_SOURCE_REALM_DIR: testSourceRealmDir,
      },
    },
  );

  mirrorChildOutput(
    child,
    supportLog,
    (next) => {
      logs = next;
    },
    () => logs,
  );

  let supportStartedAt = Date.now();
  let payload = await waitForMetadataFile<{
    realmDir: string;
    context: Record<string, unknown>;
  }>(metadataFile, child, () => logs);
  supportLog.info(
    `serve:support ready in ${((Date.now() - supportStartedAt) / 1000).toFixed(
      1,
    )}s`,
  );

  let preparedRealmDirs = [
    ...new Set([
      realmDir,
      bootstrapTargetRealmDir,
      testRealmRunnerDir,
      testSourceRealmDir,
    ]),
  ];
  let preparedTemplates = await prepareTemplatesForRealms(
    preparedRealmDirs,
    payload.context,
    resolve(sharedRuntimeDir, 'cache.json'),
  );
  let primaryTemplate =
    preparedTemplates.find((entry) => entry.realmDir === realmDir) ??
    preparedTemplates[0];

  writeSupportMetadata({
    ...payload,
    pid: child.pid,
    templateDatabaseName: primaryTemplate?.templateDatabaseName,
    templateRealmURL: primaryTemplate?.templateRealmURL,
    templateRealmServerURL: primaryTemplate?.templateRealmServerURL,
    preparedTemplates,
  });

  setupLog.info(
    `global setup finished in ${((Date.now() - setupStartedAt) / 1000).toFixed(
      1,
    )}s`,
  );
}
