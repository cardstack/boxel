import * as fs from 'fs';
import * as path from 'path';
import { isQuiet } from './cli-log';

export interface MisplacedLocalRealmEntry {
  manifestPath: string;
  currentDir: string;
  expectedDir: string;
  realmUrl: string;
}

interface MinimalManifest {
  realmUrl: string;
}

let didWarnInProcess = false;

const SKIPPABLE_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  '.boxel-history',
  '.claude',
]);

function isSkippableDir(dirName: string): boolean {
  return SKIPPABLE_DIR_NAMES.has(dirName);
}

function canonicalDomainFromHost(hostname: string): string {
  if (hostname === 'stack.cards' || hostname.endsWith('.stack.cards')) {
    return 'stack.cards';
  }
  if (hostname === 'boxel.ai' || hostname.endsWith('.boxel.ai')) {
    return 'boxel.ai';
  }
  return hostname;
}

export function relativeStructuredPathForRealmUrl(realmUrl: string): string {
  const url = new URL(realmUrl);
  const domain = canonicalDomainFromHost(url.hostname);
  const parts = url.pathname
    .replace(/^\/|\/$/g, '')
    .split('/')
    .filter(Boolean);
  const owner = parts[0] ?? 'unknown-owner';
  const realm = parts[1] ?? parts[0] ?? 'workspace';
  return path.join(domain, owner, realm);
}

export function absoluteStructuredPathForRealmUrl(
  realmUrl: string,
  rootDir: string,
): string {
  return path.resolve(rootDir, relativeStructuredPathForRealmUrl(realmUrl));
}

function tryReadRealmUrl(manifestPath: string): MinimalManifest | null {
  let content: string;
  try {
    content = fs.readFileSync(manifestPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = (parsed as Record<string, unknown>).realmUrl;
  if (typeof candidate !== 'string' || candidate === '') {
    return null;
  }
  return { realmUrl: candidate };
}

function addManifestIfExists(dir: string, manifests: string[]): void {
  const manifestPath = path.join(dir, '.boxel-sync.json');
  if (fs.existsSync(manifestPath)) {
    manifests.push(manifestPath);
  }
}

function listSubdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !isSkippableDir(entry.name))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

function findManifestPaths(rootDir: string): string[] {
  const manifests: string[] = [];
  const absoluteRoot = path.resolve(rootDir);

  // Legacy layout: <root>/<realm>/.boxel-sync.json
  for (const childDir of listSubdirs(absoluteRoot)) {
    addManifestIfExists(childDir, manifests);
  }

  // Canonical layout: <root>/<domain>/<owner>/<realm>/.boxel-sync.json
  for (const domainDir of listSubdirs(absoluteRoot)) {
    for (const ownerDir of listSubdirs(domainDir)) {
      for (const realmDir of listSubdirs(ownerDir)) {
        addManifestIfExists(realmDir, manifests);
      }
    }
  }

  return manifests;
}

export function findMisplacedLocalRealmDirs(
  rootDir: string,
): MisplacedLocalRealmEntry[] {
  const absoluteRoot = path.resolve(rootDir);
  const manifestPaths = findManifestPaths(absoluteRoot);

  const seenManifestPaths = new Set<string>();
  const entries: MisplacedLocalRealmEntry[] = [];
  for (const manifestPath of manifestPaths) {
    if (seenManifestPaths.has(manifestPath)) {
      continue;
    }
    seenManifestPaths.add(manifestPath);

    const manifest = tryReadRealmUrl(manifestPath);
    if (!manifest) {
      continue;
    }

    const currentDir = path.dirname(manifestPath);
    const expectedDir = absoluteStructuredPathForRealmUrl(
      manifest.realmUrl,
      absoluteRoot,
    );

    if (path.resolve(currentDir) !== path.resolve(expectedDir)) {
      entries.push({
        manifestPath,
        currentDir,
        expectedDir,
        realmUrl: manifest.realmUrl,
      });
    }
  }

  return entries;
}

export function warnIfMisplacedLocalRealmDirs(rootDir: string): void {
  if (didWarnInProcess) return;
  if (process.env.BOXEL_DISABLE_PATH_WARNING === '1') return;
  if (isQuiet()) return;

  const entries = findMisplacedLocalRealmDirs(rootDir);
  if (entries.length === 0) return;

  didWarnInProcess = true;

  console.warn('\n⚠️  Detected local realm directories at legacy local paths:');
  const absoluteRoot = path.resolve(rootDir);
  for (const entry of entries.slice(0, 5)) {
    const from = path.relative(absoluteRoot, entry.currentDir) || '.';
    const to = path.relative(absoluteRoot, entry.expectedDir) || '.';
    console.warn(`   - ${from} -> ${to}`);
  }
  if (entries.length > 5) {
    console.warn(`   ...and ${entries.length - 5} more`);
  }
  console.warn('\nRun to preview:');
  console.warn('   boxel consolidate-workspaces . --dry-run');
  console.warn('Then apply:');
  console.warn('   boxel consolidate-workspaces .\n');
}

/**
 * Test-only escape hatch — resets the once-per-process warning latch so tests
 * can exercise `warnIfMisplacedLocalRealmDirs` repeatedly within a single
 * Node process.
 */
export function resetWarnedFlagForTests(): void {
  didWarnInProcess = false;
}
