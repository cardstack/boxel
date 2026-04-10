import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { Client as PgClient } from 'pg';

import {
  baseRealmDir,
  CACHE_VERSION,
  DEFAULT_PG_HOST,
  DEFAULT_PG_PORT,
  DEFAULT_PG_USER,
  hashRealmFixture,
  hashString,
  logTimed,
  packageRoot,
  pgAdminConnectionConfig,
  quotePgIdentifier,
  stableStringify,
  templateLog,
  type CombinedRealmFixture,
} from './shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DB_SNAPSHOTS_DIR = resolve(packageRoot, 'db-snapshots');
export const DUMP_FILE = join(DB_SNAPSHOTS_DIR, 'template.pgdump');
export const FINGERPRINT_FILE = join(DB_SNAPSHOTS_DIR, 'fingerprint.json');

/**
 * The source realm fixture dir. This is a symlink to realm/ so they
 * can never diverge. Only .gts files (card definitions) and index.json
 * are relevant for the test DB.
 */
export const SOURCE_REALM_FIXTURE_DIR = resolve(
  packageRoot,
  'test-fixtures/public-software-factory-source',
);

/** Canonical fixture list matching playwright.global-setup.ts. */
export const DEFAULT_SNAPSHOT_FIXTURES: CombinedRealmFixture[] = [
  {
    realmDir: resolve(packageRoot, 'test-fixtures/darkfactory-adopter'),
    realmPath: 'test/',
  },
  {
    realmDir: resolve(packageRoot, 'test-fixtures/bootstrap-target'),
    realmPath: 'bootstrap-target/',
  },
  {
    realmDir: resolve(packageRoot, 'test-fixtures/test-realm-runner'),
    realmPath: 'test-realm-runner/',
  },
  {
    realmDir: SOURCE_REALM_FIXTURE_DIR,
    realmPath: 'public-software-factory-source/',
  },
];

/**
 * Space-separated glob controlling which source realm files are included
 * in the test DB snapshot. Prefix a pattern with ! to exclude.
 * Evaluated in order — last matching pattern wins.
 *
 * Only the core card definitions (darkfactory, test-results) are needed
 * for tests. The wiki, document, and other content in realm/ are not
 * necessary for the Playwright test suite.
 */
export const SOURCE_REALM_GLOB = '*.gts .realm.json !document.gts !wiki.gts';

export function matchesSourceRealmGlob(relativePath: string): boolean {
  let filename = relativePath.split('/').pop() ?? relativePath;
  let included = false;
  for (let pattern of SOURCE_REALM_GLOB.split(/\s+/)) {
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotFingerprintData {
  fingerprint: string;
  cacheVersion: number;
  /** Metadata only — not part of fingerprint hash. */
  realmServerURL: string;
  /** ISO timestamp. */
  generatedAt: string;
  /** Output from pg_dump --version. */
  pgDumpVersion: string;
}

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

/**
 * Check whether the given fixtures match the canonical snapshot fixture set.
 * Only canonical fixtures should read/write the committed snapshot.
 */
export function isCanonicalFixtureSet(
  fixtures: CombinedRealmFixture[],
): boolean {
  if (fixtures.length !== DEFAULT_SNAPSHOT_FIXTURES.length) {
    return false;
  }
  let canonical = DEFAULT_SNAPSHOT_FIXTURES.map((f) => f.realmDir).sort();
  let actual = fixtures.map((f) => resolve(f.realmDir)).sort();
  return canonical.every((dir, i) => dir === actual[i]);
}

/**
 * Compute a deterministic fingerprint string for the given fixtures.
 * Pure computation — no I/O beyond file hashing.
 */
export function computeSnapshotFingerprint(
  fixtures: CombinedRealmFixture[],
): string {
  let baseRealmHash = hashRealmFixture(baseRealmDir);
  // Hash each fixture, applying a .gts-only filter to the source realm
  // (which is a symlink to realm/ and contains many instance .json files
  // that aren't used by tests).
  let fixtureEntries = fixtures
    .slice()
    .sort((a, b) => a.realmPath.localeCompare(b.realmPath))
    .map((f) => {
      let resolvedDir = realpathSync(f.realmDir);
      let isSourceRealm =
        resolvedDir === realpathSync(SOURCE_REALM_FIXTURE_DIR);
      let hash = hashRealmFixture(
        f.realmDir,
        isSourceRealm ? { fileFilter: matchesSourceRealmGlob } : undefined,
      );
      return `${f.realmPath}:${hash}`;
    });
  let combinedFixtureHash = hashString(fixtureEntries.join('||'));
  return hashString(
    stableStringify({
      version: CACHE_VERSION,
      baseRealmHash,
      combinedFixtureHash,
    }),
  );
}

// ---------------------------------------------------------------------------
// Fingerprint I/O
// ---------------------------------------------------------------------------

/** Read and parse the committed fingerprint. Returns undefined if missing or malformed. */
export function readSnapshotFingerprint(): SnapshotFingerprintData | undefined {
  if (!existsSync(FINGERPRINT_FILE)) {
    return undefined;
  }
  try {
    return JSON.parse(
      readFileSync(FINGERPRINT_FILE, 'utf8'),
    ) as SnapshotFingerprintData;
  } catch {
    return undefined;
  }
}

/** Atomic write of fingerprint data (temp file + rename). */
export function writeSnapshotFingerprint(data: SnapshotFingerprintData): void {
  mkdirSync(DB_SNAPSHOTS_DIR, { recursive: true });
  let tempFile = join(
    dirname(FINGERPRINT_FILE),
    `.fingerprint.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tempFile, JSON.stringify(data, null, 2) + '\n');
  renameSync(tempFile, FINGERPRINT_FILE);
}

// ---------------------------------------------------------------------------
// pg_dump / pg_restore helpers
// ---------------------------------------------------------------------------

/** Parse the pg_dump version string. Returns 'unknown' on failure. */
export function getPgDumpVersion(): string {
  try {
    let result = spawnSync('pg_dump', ['--version'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function pgEnv(): Record<string, string> {
  let env = { ...process.env } as Record<string, string>;
  if (process.env.PGPASSWORD) {
    env.PGPASSWORD = process.env.PGPASSWORD;
  }
  return env;
}

/**
 * Dump a template database to disk using pg_dump --format=custom.
 *
 * To minimize dump size, we clone the template to a temporary database,
 * strip data that is rebuilt at clone/startup time, then dump that copy:
 * - boxel_index_working: rebuilt via rebuildWorkingIndexFromIndex()
 * - boxel_index.last_known_good_deps: fallback deps, rebuilt on next index
 * - modules: cleared via clearModuleCache() on realm startup
 * - jobs / job_reservations: cleared via resetQueueState()
 */
export async function dumpTemplateToDisk(databaseName: string): Promise<void> {
  mkdirSync(DB_SNAPSHOTS_DIR, { recursive: true });

  // Clone to a temporary database so we can strip columns without
  // modifying the live template.
  let tmpDb = `sf_dump_tmp_${process.pid}`;
  let adminClient = new PgClient(pgAdminConnectionConfig());
  try {
    await adminClient.connect();
    await adminClient.query(
      `DROP DATABASE IF EXISTS ${quotePgIdentifier(tmpDb)}`,
    );
    await adminClient.query(
      `CREATE DATABASE ${quotePgIdentifier(tmpDb)} TEMPLATE ${quotePgIdentifier(databaseName)}`,
    );
  } finally {
    await adminClient.end();
  }

  try {
    // NULL out large columns that are rebuilt at runtime.
    let stripClient = new PgClient(pgAdminConnectionConfig(tmpDb));
    try {
      await stripClient.connect();
      await stripClient.query(
        `UPDATE boxel_index SET last_known_good_deps = NULL`,
      );
      await stripClient.query(`TRUNCATE boxel_index_working`);
      await stripClient.query(`TRUNCATE modules`);
      await stripClient.query(`TRUNCATE job_reservations, jobs CASCADE`);
      await stripClient.query(`VACUUM FULL`);
    } finally {
      await stripClient.end();
    }

    let result = spawnSync(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '-h',
        DEFAULT_PG_HOST,
        '-p',
        DEFAULT_PG_PORT,
        '-U',
        DEFAULT_PG_USER,
        '-f',
        DUMP_FILE,
        tmpDb,
      ],
      { env: pgEnv(), encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(
        `pg_dump failed with exit code ${result.status}: ${result.stderr || result.error?.message || 'unknown error'}`,
      );
    }
  } finally {
    // Clean up the temporary database.
    let cleanupClient = new PgClient(pgAdminConnectionConfig());
    try {
      await cleanupClient.connect();
      await cleanupClient.query(
        `DROP DATABASE IF EXISTS ${quotePgIdentifier(tmpDb)}`,
      );
    } finally {
      await cleanupClient.end();
    }
  }
}

/**
 * Restore a template database from the committed dump file.
 * Steps: CREATE DATABASE, pg_restore, ALTER DATABASE IS_TEMPLATE true.
 * On failure at any step, attempts to drop the partially created DB.
 */
export async function restoreTemplateFromDisk(
  databaseName: string,
): Promise<void> {
  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    await client.query(`CREATE DATABASE ${quotePgIdentifier(databaseName)}`);
  } finally {
    await client.end();
  }

  try {
    let result = spawnSync(
      'pg_restore',
      [
        '--no-owner',
        '--no-privileges',
        '--single-transaction',
        '-h',
        DEFAULT_PG_HOST,
        '-p',
        DEFAULT_PG_PORT,
        '-U',
        DEFAULT_PG_USER,
        '-d',
        databaseName,
        DUMP_FILE,
      ],
      { env: pgEnv(), encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(
        `pg_restore failed with exit code ${result.status}: ${result.stderr || result.error?.message || 'unknown error'}`,
      );
    }

    let templateClient = new PgClient(pgAdminConnectionConfig());
    try {
      await templateClient.connect();
      await templateClient.query(
        `ALTER DATABASE ${quotePgIdentifier(databaseName)} WITH IS_TEMPLATE true`,
      );
    } finally {
      await templateClient.end();
    }
  } catch (error) {
    // Best-effort cleanup: drop the partially created DB.
    try {
      let cleanupClient = new PgClient(pgAdminConnectionConfig());
      try {
        await cleanupClient.connect();
        await cleanupClient.query(
          `DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)}`,
        );
      } finally {
        await cleanupClient.end();
      }
    } catch {
      // Swallow cleanup errors — the original error is more important.
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// High-level snapshot operations
// ---------------------------------------------------------------------------

/**
 * Check whether a committed snapshot exists and matches the current source files.
 * Returns fingerprint data if valid, undefined if stale or missing.
 */
export function checkCommittedSnapshot(
  fixtures: CombinedRealmFixture[],
): SnapshotFingerprintData | undefined {
  if (!existsSync(DUMP_FILE) || !existsSync(FINGERPRINT_FILE)) {
    return undefined;
  }

  let data = readSnapshotFingerprint();
  if (!data) {
    return undefined;
  }

  let currentFingerprint = computeSnapshotFingerprint(fixtures);
  if (data.fingerprint !== currentFingerprint) {
    return undefined;
  }

  return data;
}

/**
 * Save a snapshot of the template database to disk with fingerprint metadata.
 * Called after a successful full build.
 */
export async function saveSnapshot(
  databaseName: string,
  realmServerURL: string,
  fixtures: CombinedRealmFixture[],
): Promise<void> {
  await logTimed(templateLog, 'saveSnapshot', async () => {
    let fingerprint = computeSnapshotFingerprint(fixtures);

    await dumpTemplateToDisk(databaseName);

    let dumpSize = statSync(DUMP_FILE).size;
    templateLog.info(
      `snapshot dump written: ${(dumpSize / 1024 / 1024).toFixed(1)} MB`,
    );

    writeSnapshotFingerprint({
      fingerprint,
      cacheVersion: CACHE_VERSION,
      realmServerURL,
      generatedAt: new Date().toISOString(),
      pgDumpVersion: getPgDumpVersion(),
    });
  });
}
