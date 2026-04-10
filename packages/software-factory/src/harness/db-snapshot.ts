import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
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
  hashCombinedRealmFixtures,
  hashRealmFixture,
  hashString,
  logTimed,
  packageRoot,
  pgAdminConnectionConfig,
  quotePgIdentifier,
  sourceRealmDir,
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
    realmDir: resolve(
      packageRoot,
      'test-fixtures/public-software-factory-source',
    ),
    realmPath: 'public-software-factory-source/',
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotFingerprintData {
  fingerprint: string;
  cacheVersion: number;
  baseRealmHash: string;
  sourceRealmHash: string;
  combinedFixtureHash: string;
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
 * Compute a deterministic fingerprint string for the given fixtures.
 * Pure computation — no I/O beyond file hashing.
 */
export function computeSnapshotFingerprint(
  fixtures: CombinedRealmFixture[],
): string {
  let baseRealmHash = hashRealmFixture(baseRealmDir);
  let sourceRealmHash = hashRealmFixture(sourceRealmDir);
  let combinedFixtureHash = hashCombinedRealmFixtures(fixtures);
  return hashString(
    stableStringify({
      version: CACHE_VERSION,
      baseRealmHash,
      sourceRealmHash,
      combinedFixtureHash,
    }),
  );
}

// ---------------------------------------------------------------------------
// Fingerprint I/O
// ---------------------------------------------------------------------------

/** Read and parse the committed fingerprint. Returns undefined if missing or malformed. */
export function readSnapshotFingerprint():
  | SnapshotFingerprintData
  | undefined {
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
  writeFileSync(tempFile, JSON.stringify(data, null, 2));
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
  return {
    ...process.env,
    PGPASSWORD: process.env.PGPASSWORD || '',
  } as Record<string, string>;
}

/** Dump a template database to disk using pg_dump --format=custom. */
export function dumpTemplateToDisk(databaseName: string): void {
  mkdirSync(DB_SNAPSHOTS_DIR, { recursive: true });
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
      databaseName,
    ],
    { env: pgEnv(), encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `pg_dump failed with exit code ${result.status}: ${result.stderr || result.error?.message || 'unknown error'}`,
    );
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
    await client.query(
      `CREATE DATABASE ${quotePgIdentifier(databaseName)}`,
    );
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
    let baseRealmHash = hashRealmFixture(baseRealmDir);
    let sourceRealmHash = hashRealmFixture(sourceRealmDir);
    let combinedFixtureHash = hashCombinedRealmFixtures(fixtures);
    let fingerprint = hashString(
      stableStringify({
        version: CACHE_VERSION,
        baseRealmHash,
        sourceRealmHash,
        combinedFixtureHash,
      }),
    );

    dumpTemplateToDisk(databaseName);

    let dumpSize = statSync(DUMP_FILE).size;
    templateLog.info(
      `snapshot dump written: ${(dumpSize / 1024 / 1024).toFixed(1)} MB`,
    );

    writeSnapshotFingerprint({
      fingerprint,
      cacheVersion: CACHE_VERSION,
      baseRealmHash,
      sourceRealmHash,
      combinedFixtureHash,
      realmServerURL,
      generatedAt: new Date().toISOString(),
      pgDumpVersion: getPgDumpVersion(),
    });
  });
}
