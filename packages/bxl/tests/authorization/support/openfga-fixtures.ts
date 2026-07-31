import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPENFGA_FIXTURE_COMMIT =
  '2c19e265fc73858fc0a5468fc517dc3bbf727e94';

const countKeys = [
  'tests',
  'stages',
  'checkAssertions',
  'listObjectsAssertions',
  'listUsersAssertions',
] as const;

export type OpenFgaFixtureCountKey = (typeof countKeys)[number];
export type OpenFgaFixtureCounts = Record<OpenFgaFixtureCountKey, number>;

interface FixtureManifestFile {
  path: string;
  sourcePath: string;
  sha256: string;
  counts: OpenFgaFixtureCounts;
}

interface FixtureManifest {
  schemaVersion: number;
  source: {
    repository: string;
    commit: string;
    license: string;
  };
  files: FixtureManifestFile[];
  totals: OpenFgaFixtureCounts & { assertions: number };
}

export interface VerifiedOpenFgaFixtureInventory {
  root: string;
  manifest: FixtureManifest;
  counts: OpenFgaFixtureCounts & { assertions: number };
}

function fixtureRoot(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'fixtures',
    'openfga',
    OPENFGA_FIXTURE_COMMIT,
  );
}

function sha256(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function indentation(line: string): number {
  const match = /^( *)/.exec(line);
  return match?.[1].length ?? 0;
}

/**
 * Count sequence entries directly beneath every occurrence of a known YAML
 * key. This is intentionally not a general YAML parser: Phase 0 only verifies
 * the immutable upstream fixture inventory, while the later test-only importer
 * owns full YAML and model parsing.
 */
function countDirectSequenceEntries(source: string, key: string): number {
  const lines = source.split(/\r?\n/);
  let count = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const match = new RegExp(`^( *)${key}:\\s*(?:#.*)?$`).exec(line);
    if (!match) continue;

    const keyIndent = match[1]!.length;
    for (let childIndex = index + 1; childIndex < lines.length; childIndex++) {
      const child = lines[childIndex]!;
      const trimmed = child.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const childIndent = indentation(child);
      if (childIndent <= keyIndent) break;
      if (childIndent === keyIndent + 2 && trimmed.startsWith('- ')) count++;
    }
  }

  return count;
}

function countFixture(source: string): OpenFgaFixtureCounts {
  return Object.fromEntries(
    countKeys.map((key) => [key, countDirectSequenceEntries(source, key)]),
  ) as unknown as OpenFgaFixtureCounts;
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function verifyOpenFgaFixtureInventory(): VerifiedOpenFgaFixtureInventory {
  const root = fixtureRoot();
  const manifest = JSON.parse(
    readFileSync(join(root, 'manifest.json'), 'utf8'),
  ) as FixtureManifest;

  assertEqual(manifest.schemaVersion, 1, 'fixture manifest schema version');
  assertEqual(manifest.source.commit, OPENFGA_FIXTURE_COMMIT, 'fixture source commit');
  assertEqual(manifest.files.length, 2, 'fixture file count');

  const totals = Object.fromEntries(countKeys.map((key) => [key, 0])) as
    OpenFgaFixtureCounts;

  for (const file of manifest.files) {
    const contents = readFileSync(join(root, file.path));
    assertEqual(sha256(contents), file.sha256, `${file.path} SHA-256`);

    const counts = countFixture(contents.toString('utf8'));
    for (const key of countKeys) {
      assertEqual(counts[key], file.counts[key], `${file.path} ${key}`);
      totals[key] += counts[key];
    }
  }

  const assertions =
    totals.checkAssertions +
    totals.listObjectsAssertions +
    totals.listUsersAssertions;

  for (const key of countKeys) {
    assertEqual(totals[key], manifest.totals[key], `fixture total ${key}`);
  }
  assertEqual(assertions, manifest.totals.assertions, 'fixture total assertions');

  return {
    root,
    manifest,
    counts: { ...totals, assertions },
  };
}
