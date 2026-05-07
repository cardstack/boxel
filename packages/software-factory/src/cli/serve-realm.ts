// This should be first
import '../setup-logger';

import {
  readSupportContext,
  startFactoryRealmServer,
} from '@cardstack/realm-test-harness';
import { logger } from '../logger';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { RealmPermissions } from '@cardstack/runtime-common';

let log = logger('serve-realm');

function parseCliArg(name: string): string | undefined {
  let prefix = `--${name}=`;
  let arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function parseCliNumber(name: string): number | undefined {
  let value = parseCliArg(name);
  if (value == null) {
    return undefined;
  }
  let parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a valid number, received: ${value}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  // First positional arg is realmDir (skip --flags)
  let positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let realmDir = resolve(
    process.cwd(),
    positional[0] ?? 'test-fixtures/darkfactory-adopter',
  );

  if (!process.env.TEST_HARNESS_CONTEXT) {
    let supportContext = readSupportContext();
    if (supportContext) {
      process.env.TEST_HARNESS_CONTEXT = JSON.stringify(supportContext);
    }
  }

  let permissions: RealmPermissions | undefined;
  if (process.env.TEST_HARNESS_PERMISSIONS) {
    try {
      permissions = JSON.parse(process.env.TEST_HARNESS_PERMISSIONS);
    } catch (e) {
      throw new Error(
        `TEST_HARNESS_PERMISSIONS is not valid JSON: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  let runtime = await startFactoryRealmServer({
    realmDir,
    permissions,
    templateDatabaseName: process.env.TEST_HARNESS_TEMPLATE_DATABASE_NAME,
    templateRealmServerURL: process.env.TEST_HARNESS_TEMPLATE_REALM_SERVER_URL
      ? new URL(process.env.TEST_HARNESS_TEMPLATE_REALM_SERVER_URL)
      : undefined,
    realmServerPort: parseCliNumber('realmServerPort'),
    compatRealmServerPort: parseCliNumber('compatRealmServerPort'),
    prerenderURL: parseCliArg('prerenderURL'),
  });

  let payload = {
    realmDir,
    realmURL: runtime.realmURL.href,
    realmServerURL: runtime.realmServerURL.href,
    databaseName: runtime.databaseName,
    ports: runtime.ports,
    sampleCardURL: runtime.cardURL('project-demo'),
    ownerBearerToken: runtime.createBearerToken(),
  };

  if (process.env.TEST_HARNESS_METADATA_FILE) {
    writeFileSync(
      process.env.TEST_HARNESS_METADATA_FILE,
      JSON.stringify(payload, null, 2),
    );
  }

  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');

  let cleanExit = false;
  process.on('exit', () => {
    if (!cleanExit) {
      for (let pid of runtime.childPids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already dead
        }
      }
    }
  });

  let stop = async () => {
    await runtime.stop();
    cleanExit = true;
  };

  await new Promise<void>((resolve, reject) => {
    let handleSignal = () => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      void stop().then(resolve).catch(reject);
    };
    let onSigint = () => handleSignal();
    let onSigterm = () => handleSignal();
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
  });
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    log.error(error.stack ?? error.message);
  } else {
    log.error(String(error));
  }
  process.exitCode = 1;
});
