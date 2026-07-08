// This should be first
import '../setup-logger.ts';

import {
  readSupportContext,
  startFactoryRealmServer,
  writeMetadataFileAtomically,
  type RealmConfig,
} from '@cardstack/realm-test-harness';
import { logger } from '../logger.ts';
import { resolve } from 'node:path';

import type { RealmPermissions } from '@cardstack/runtime-common';

let log = logger('serve-realm');

// Glob controlling which SF source-realm files are copied into the
// realm process. Card definitions only — no instance data (e.g. wiki
// briefs, documents) which tests don't depend on and which would slow
// indexing. Format: space-separated patterns; prefix with `!` to exclude.
// Last matching pattern wins. Must agree with the same constant in
// `cli/cache-realm.ts` so the per-process realm and the cached template
// see the exact same fixture contents.
const SF_CARD_DEFINITIONS_GLOB = '*.gts realm.json !document.gts !wiki.gts';

function cardDefinitionsOnly(relativePath: string): boolean {
  let filename = relativePath.split('/').pop() ?? relativePath;
  let included = false;
  for (let pattern of SF_CARD_DEFINITIONS_GLOB.split(/\s+/)) {
    let negate = pattern.startsWith('!');
    let glob = negate ? pattern.slice(1) : pattern;
    let hit = glob.startsWith('*')
      ? filename.endsWith(glob.slice(1))
      : filename === glob;
    if (hit) {
      included = !negate;
    }
  }
  return included;
}

const sfSourceRealmDir = resolve(import.meta.dirname, '..', '..', 'realm');

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

function parseCliBool(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface SerializableRealmConfig {
  dir: string;
  path: string;
  permissions?: RealmPermissions;
  username?: string;
}

function parseRealmsEnv(): RealmConfig[] | undefined {
  let raw = process.env.TEST_HARNESS_REALMS;
  if (!raw) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `TEST_HARNESS_REALMS is not valid JSON: ${e instanceof Error ? e.message : e}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      'TEST_HARNESS_REALMS must be a non-empty array of realm configs',
    );
  }
  return (parsed as SerializableRealmConfig[]).map((entry) => ({
    dir: resolve(process.cwd(), entry.dir),
    path: entry.path,
    permissions: entry.permissions,
    username: entry.username,
  }));
}

async function main(): Promise<void> {
  // First positional arg is the primary realmDir (skip --flags). Used only
  // when TEST_HARNESS_REALMS is not provided (single-realm convenience).
  let positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let realmDirArg = resolve(
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

  let realms = parseRealmsEnv();
  if (!realms) {
    realms = [{ dir: realmDirArg, path: 'test/', permissions }];
  } else if (permissions) {
    // TEST_HARNESS_PERMISSIONS overrides the primary realm's permissions —
    // matches the previous single-realm flag's contract.
    realms = [{ ...realms[0], permissions }, ...realms.slice(1)];
  }
  // SF tests adopt cards from `software-factory/...` modules. Always mount
  // the SF source realm alongside the test fixture so those module URLs
  // resolve. The fileFilter is materialized here (rather than passed via
  // env from fixtures.ts) because functions aren't JSON-serializable.
  if (!realms.some((r) => r.path === 'software-factory/')) {
    realms = [
      ...realms,
      {
        dir: sfSourceRealmDir,
        path: 'software-factory/',
        username: 'software_factory_realm',
        // fileFilter is added below — we have to keep RealmConfig
        // serializable up to this point in case TEST_HARNESS_REALMS was used.
      },
    ];
  }
  realms = realms.map((realm) =>
    realm.path === 'software-factory/'
      ? { ...realm, fileFilter: cardDefinitionsOnly }
      : realm,
  );
  let primaryRealmDir = realms[0].dir;

  let runtime = await startFactoryRealmServer({
    realms,
    templateDatabaseName: process.env.TEST_HARNESS_TEMPLATE_DATABASE_NAME,
    templateRealmServerURL: process.env.TEST_HARNESS_TEMPLATE_REALM_SERVER_URL
      ? new URL(process.env.TEST_HARNESS_TEMPLATE_REALM_SERVER_URL)
      : undefined,
    realmServerPort: parseCliNumber('realmServerPort'),
    compatRealmServerPort: parseCliNumber('compatRealmServerPort'),
    prerenderURL: parseCliArg('prerenderURL'),
    // When the Playwright fixture spawns this child, the worker process
    // owns the compat proxy for the testWorker's whole lifetime (so the
    // stable compat-realm-server port stays bound across per-test
    // serve-realm spawns) and calls `setTargetPort` itself after reading
    // the realm-server port out of this child's metadata file. In that
    // mode the child must not bind the compat port — the fixture passes
    // `--no-compat-proxy`. Standalone `pnpm serve:realm` omits the flag
    // and gets the in-stack proxy.
    noCompatProxy: parseCliBool('no-compat-proxy'),
  });

  let payload = {
    realmDir: primaryRealmDir,
    realmURL: runtime.realmURL.href,
    realmServerURL: runtime.realmServerURL.href,
    databaseName: runtime.databaseName,
    ports: runtime.ports,
    sampleCardURL: runtime.cardURL('project-demo'),
    ownerBearerToken: runtime.createBearerToken(),
  };

  if (process.env.TEST_HARNESS_METADATA_FILE) {
    writeMetadataFileAtomically(
      process.env.TEST_HARNESS_METADATA_FILE,
      payload,
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
