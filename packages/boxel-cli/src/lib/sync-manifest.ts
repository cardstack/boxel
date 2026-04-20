import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface SyncManifest {
  realmUrl: string;
  files: Record<string, string>; // relativePath -> contentHash
  remoteMtimes?: Record<string, number>; // relativePath -> last-seen server mtime
}

export function isValidManifest(value: unknown): value is SyncManifest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.realmUrl !== 'string') return false;
  if (typeof v.files !== 'object' || v.files === null) return false;
  for (const hash of Object.values(v.files as Record<string, unknown>)) {
    if (typeof hash !== 'string') return false;
  }
  if (v.remoteMtimes !== undefined) {
    if (typeof v.remoteMtimes !== 'object' || v.remoteMtimes === null) {
      return false;
    }
    for (const mtime of Object.values(
      v.remoteMtimes as Record<string, unknown>,
    )) {
      if (typeof mtime !== 'number') return false;
    }
  }
  return true;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

export async function loadManifest(
  localDir: string,
): Promise<SyncManifest | null> {
  const manifestPath = path.join(localDir, '.boxel-sync.json');
  let content: string;
  try {
    content = await fs.readFile(manifestPath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!isValidManifest(parsed)) {
    console.warn(
      'Warning: .boxel-sync.json is malformed or has an unexpected shape; falling back to a full upload.',
    );
    return null;
  }

  return parsed;
}

export async function saveManifest(
  localDir: string,
  manifest: SyncManifest,
): Promise<void> {
  const manifestPath = path.join(localDir, '.boxel-sync.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
