import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  createTestRealmViaCli,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel realm sync status [local-dir]` is driven as a subprocess. The command
// has no `--json` mode, so its structured result is asserted against the
// human-readable output the CLI renders (ANSI colors are disabled because the
// piped stdout is not a TTY). Local-dir / manifest state and realm state are
// set up and inspected in-process.

let home: string;
let cleanupProfile: () => void;
let localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-status-int-'));
  localDirs.push(dir);
  return dir;
}

function writeLocalFile(localDir: string, relPath: string, content: string) {
  let fullPath = path.join(localDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function readLocalFile(localDir: string, relPath: string): string {
  return fs.readFileSync(path.join(localDir, relPath), 'utf8');
}

function localFileExists(localDir: string, relPath: string): boolean {
  return fs.existsSync(path.join(localDir, relPath));
}

function manifestMtime(localDir: string): number {
  return fs.statSync(path.join(localDir, '.boxel-sync.json')).mtimeMs;
}

// Drive the sync subprocess (used to establish baselines).
function runSync(
  localDir: string,
  realmUrl: string,
  flags: string[] = [],
): ReturnType<typeof runBoxel> {
  return runBoxel(['realm', 'sync', localDir, realmUrl, ...flags], { home });
}

// Drive the status subprocess. `status` is nested under `sync`
// (`realm sync status`).
function runStatus(
  dir: string,
  flags: string[] = [],
): ReturnType<typeof runBoxel> {
  return runBoxel(['realm', 'sync', 'status', dir, ...flags], { home });
}

// --- Parse `renderStatus` output back into structured entries -------------
//
// renderStatus groups changed files under section headers, one item per line
// as `   <marker> <file>`. We map each header to the same status string the
// programmatic `status()` result used, so the ported assertions read the same.

type ParsedStatus =
  | 'new-remote'
  | 'modified-remote'
  | 'new-local'
  | 'modified-local'
  | 'conflict'
  | 'deleted-local'
  | 'deleted-remote'
  | 'pulled';

const HEADER_TO_STATUS: Array<[string, ParsedStatus]> = [
  ['New on remote', 'new-remote'],
  ['Modified on remote', 'modified-remote'],
  ['New locally', 'new-local'],
  ['Modified locally', 'modified-local'],
  ['Conflicts', 'conflict'],
  ['Deleted locally', 'deleted-local'],
  ['Deleted on remote', 'deleted-remote'],
  ['Pulled', 'pulled'],
];

function parseStatusEntries(
  stdout: string,
): Array<{ file: string; status: ParsedStatus }> {
  let current: ParsedStatus | null = null;
  let entries: Array<{ file: string; status: ParsedStatus }> = [];
  for (let raw of stdout.split('\n')) {
    // Headers are matched before item lines because the deleted-file section
    // headers themselves begin with `- ` (which otherwise looks like an item).
    let header = HEADER_TO_STATUS.find(([h]) => raw.includes(h));
    if (header) {
      current = header[1];
      continue;
    }
    let item = raw.trim().match(/^([+~!✓-])\s+(.+?)\s*$/);
    if (item && current) {
      entries.push({ file: item[2], status: current });
    }
  }
  return entries;
}

// The status-of-a-file, excluding the "Pulled" section — mirrors the original
// `statusesFor(result, file)` which read `result.changes`.
function statusesFor(stdout: string, file: string): string[] {
  return parseStatusEntries(stdout)
    .filter((e) => e.file === file && e.status !== 'pulled')
    .map((e) => e.status);
}

function pulledFiles(stdout: string): string[] {
  return parseStatusEntries(stdout)
    .filter((e) => e.status === 'pulled')
    .map((e) => e.file);
}

function isInSync(stdout: string): boolean {
  return stdout.includes('✓ In sync');
}

async function createTestRealm(): Promise<string> {
  let { realmUrl } = await createTestRealmViaCli(home);
  return realmUrl;
}

function buildFileUrl(realmUrl: string, relPath: string): string {
  let base = realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`;
  return `${base}${relPath.replace(/^\/+/, '')}`;
}

async function writeRemoteFile(
  realmUrl: string,
  relPath: string,
  content: string,
): Promise<void> {
  let url = buildFileUrl(realmUrl, relPath);
  let response = await reloadProfile(home).authedRealmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'application/vnd.card+source',
    },
    body: content,
  });
  if (!response.ok) {
    throw new Error(
      `Write ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
}

async function deleteRemoteFile(
  realmUrl: string,
  relPath: string,
): Promise<void> {
  let url = buildFileUrl(realmUrl, relPath);
  let response = await reloadProfile(home).authedRealmFetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/vnd.card+source' },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Delete ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function establishBaseline(
  localDir: string,
  realmUrl: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    writeLocalFile(localDir, relPath, content);
  }
  let res = await runSync(localDir, realmUrl, ['--prefer-local']);
  expect(res.ok, res.stderr).toBe(true);
  // Remote mtimes are second-precision — wait so subsequent edits get a new mtime.
  await sleep(1100);
}

beforeAll(async () => {
  await startTestRealmServer();
  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  for (let dir of localDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm sync status (integration)', () => {
  it('reports inSync when nothing has changed since baseline', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });

    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);

    expect(isInSync(res.stdout)).toBe(true);
    expect(statusesFor(res.stdout, 'a.gts')).toEqual([]);
    expect(res.stdout).toContain(`Realm: ${realmUrl.replace(/\/+$/, '')}`);
  });

  it('detects new remote file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    await writeRemoteFile(realmUrl, 'b.gts', 'export const b = 1;\n');

    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);

    expect(isInSync(res.stdout)).toBe(false);
    expect(statusesFor(res.stdout, 'b.gts')).toEqual(['new-remote']);
  });

  it('detects modified remote file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    await writeRemoteFile(realmUrl, 'a.gts', 'export const a = 2;\n');

    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);

    expect(statusesFor(res.stdout, 'a.gts')).toEqual(['modified-remote']);
  });

  it('detects new local file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    writeLocalFile(localDir, 'c.gts', 'export const c = 1;\n');

    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);

    expect(statusesFor(res.stdout, 'c.gts')).toEqual(['new-local']);
  });

  it('detects modified local file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    writeLocalFile(localDir, 'a.gts', 'export const a = 99;\n');

    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);

    expect(statusesFor(res.stdout, 'a.gts')).toEqual(['modified-local']);
  });

  it('detects conflict when both sides modify the same file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    writeLocalFile(localDir, 'a.gts', 'export const a = "local";\n');
    await writeRemoteFile(realmUrl, 'a.gts', 'export const a = "remote";\n');

    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);

    expect(statusesFor(res.stdout, 'a.gts')).toEqual(['conflict']);
  });

  it('detects deleted local file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    fs.unlinkSync(path.join(localDir, 'a.gts'));

    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);

    expect(statusesFor(res.stdout, 'a.gts')).toEqual(['deleted-local']);
  });

  it('detects deleted remote file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    await deleteRemoteFile(realmUrl, 'a.gts');

    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);

    expect(statusesFor(res.stdout, 'a.gts')).toEqual(['deleted-remote']);
  });

  it('--pull downloads safe remote changes and clears the diff', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    // New + modified remote, no local changes
    await writeRemoteFile(realmUrl, 'b.gts', 'export const b = 1;\n');
    await writeRemoteFile(realmUrl, 'a.gts', 'export const a = 2;\n');

    let res = await runStatus(localDir, ['--pull']);
    expect(res.ok, res.stderr).toBe(true);

    expect(pulledFiles(res.stdout).sort()).toEqual(['a.gts', 'b.gts']);
    expect(readLocalFile(localDir, 'a.gts')).toContain('a = 2');
    expect(readLocalFile(localDir, 'b.gts')).toContain('b = 1');

    let after = await runStatus(localDir);
    expect(after.ok, after.stderr).toBe(true);
    expect(isInSync(after.stdout)).toBe(true);
  });

  it('--pull leaves conflicts untouched', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    writeLocalFile(localDir, 'a.gts', 'export const a = "local";\n');
    await writeRemoteFile(realmUrl, 'a.gts', 'export const a = "remote";\n');

    let res = await runStatus(localDir, ['--pull']);
    expect(res.ok, res.stderr).toBe(true);

    expect(pulledFiles(res.stdout)).not.toContain('a.gts');
    // Local file untouched
    expect(readLocalFile(localDir, 'a.gts')).toContain('a = "local"');
  });

  it('--pull with zero safe pulls does not touch the manifest', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    let mtimeBefore = manifestMtime(localDir);
    // Wait long enough that a real write would change mtime measurably
    await sleep(50);

    let res = await runStatus(localDir, ['--pull']);
    expect(res.ok, res.stderr).toBe(true);

    expect(pulledFiles(res.stdout)).toEqual([]);
    expect(manifestMtime(localDir)).toBe(mtimeBefore);
  });

  it('errors when manifest is missing', async () => {
    let localDir = makeLocalDir();

    let res = await runStatus(localDir);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/\.boxel-sync\.json/);
  });

  it('--all walks current root and reports each sync dir', async () => {
    let root = makeLocalDir();
    let realmUrl1 = await createTestRealm();
    let realmUrl2 = await createTestRealm();
    let dirA = path.join(root, 'a');
    let dirB = path.join(root, 'nested', 'b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    writeLocalFile(dirA, 'one.gts', 'export const x = 1;\n');
    let syncA = await runSync(dirA, realmUrl1, ['--prefer-local']);
    expect(syncA.ok, syncA.stderr).toBe(true);
    writeLocalFile(dirB, 'two.gts', 'export const y = 1;\n');
    let syncB = await runSync(dirB, realmUrl2, ['--prefer-local']);
    expect(syncB.ok, syncB.stderr).toBe(true);

    // Nested dir under an ignored node_modules should NOT be discovered
    let ignored = path.join(root, 'node_modules', 'pkg');
    fs.mkdirSync(ignored, { recursive: true });
    writeLocalFile(ignored, 'ignored.gts', 'export const z = 1;\n');
    fs.writeFileSync(
      path.join(ignored, '.boxel-sync.json'),
      JSON.stringify({ realmUrl: realmUrl1, files: {} }, null, 2),
    );

    let res = await runStatus(root, ['--all']);

    // Both real sync dirs are reported; the node_modules dir is not walked.
    expect(res.stdout).toContain(dirA);
    expect(res.stdout).toContain(dirB);
    expect(res.stdout).not.toContain(ignored);
  });

  it('--all continues past a malformed manifest', async () => {
    let root = makeLocalDir();
    let realmUrl = await createTestRealm();
    let dirOk = path.join(root, 'ok');
    let dirBad = path.join(root, 'bad');
    fs.mkdirSync(dirOk, { recursive: true });
    fs.mkdirSync(dirBad, { recursive: true });
    writeLocalFile(dirOk, 'one.gts', 'export const x = 1;\n');
    let syncOk = await runSync(dirOk, realmUrl, ['--prefer-local']);
    expect(syncOk.ok, syncOk.stderr).toBe(true);
    fs.writeFileSync(path.join(dirBad, '.boxel-sync.json'), '{ not valid json');

    let res = await runStatus(root, ['--all']);

    // The malformed dir is flagged and the good dir is still reported.
    expect(res.stdout).toContain(`${dirBad}  [malformed]`);
    expect(res.stdout).toContain(dirOk);
    expect(res.stdout).not.toContain(`${dirOk}  [malformed]`);
  });

  it('--all flags a valid-JSON-but-wrong-shape manifest as malformed', async () => {
    let root = makeLocalDir();
    let dirShape = path.join(root, 'shape');
    fs.mkdirSync(dirShape, { recursive: true });
    // Valid JSON, but missing required `realmUrl` and `files` fields.
    fs.writeFileSync(
      path.join(dirShape, '.boxel-sync.json'),
      JSON.stringify({ wrong: 'shape' }),
    );

    let res = await runStatus(root, ['--all']);

    expect(res.stdout).toContain(`${dirShape}  [malformed]`);
  });

  it('--all walker discovers sync dirs under non-ignored dot-prefixed dirs', async () => {
    let root = makeLocalDir();
    let realmUrl = await createTestRealm();
    let dotDir = path.join(root, '.workspaces', 'project');
    fs.mkdirSync(dotDir, { recursive: true });
    writeLocalFile(dotDir, 'one.gts', 'export const x = 1;\n');
    let syncRes = await runSync(dotDir, realmUrl, ['--prefer-local']);
    expect(syncRes.ok, syncRes.stderr).toBe(true);

    let res = await runStatus(root, ['--all']);

    expect(res.stdout).toContain(dotDir);
  });

  it('rejects --all combined with --pull', async () => {
    let root = makeLocalDir();

    let res = await runStatus(root, ['--all', '--pull']);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Cannot use --pull with --all');
  });

  it('localDir defaults are the caller responsibility; status accepts an explicit dir', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });

    // Note: the CLI action layer is what defaults to process.cwd(); passing an
    // explicit dir pins that the command honors it.
    let res = await runStatus(localDir);
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain(`Local: ${localDir}`);
    expect(localFileExists(localDir, 'a.gts')).toBe(true);
  });
});
