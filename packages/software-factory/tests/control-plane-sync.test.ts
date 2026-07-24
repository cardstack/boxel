import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import {
  ControlPlaneSync,
  ensureControlPlaneIgnoreFile,
  isControlPath,
} from '../src/control-plane-sync.ts';

const CONTROL_REALM = 'https://example.com/user/control/';

interface FakeClient {
  client: BoxelCLIClient;
  writes: { path: string; content: string }[];
  remoteFiles: Map<string, string>;
}

function makeFakeClient(remote: Record<string, string> = {}): FakeClient {
  let writes: { path: string; content: string }[] = [];
  let remoteFiles = new Map(Object.entries(remote));
  let client = {
    listFiles: async () => ({ filenames: [...remoteFiles.keys()] }),
    read: async (_realm: string, path: string) => {
      let content = remoteFiles.get(path);
      return content !== undefined
        ? { ok: true, content }
        : { ok: false, error: 'not found' };
    },
    write: async (_realm: string, path: string, content: string) => {
      writes.push({ path, content });
      remoteFiles.set(path, content);
      return { ok: true };
    },
  } as unknown as BoxelCLIClient;
  return { client, writes, remoteFiles };
}

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'control-plane-sync-test-'));
}

test('isControlPath classifies tracker, run-log, and product paths', () => {
  assert.equal(isControlPath('Issues/seed.json'), true);
  assert.equal(isControlPath('Knowledge Articles/how-to.json'), true);
  assert.equal(isControlPath('Runs/boxel-wardrobe.json'), true);
  assert.equal(isControlPath('run-log.gts'), true);
  assert.equal(isControlPath('garment.gts'), false);
  assert.equal(isControlPath('Garment/tee.json'), false);
  assert.equal(isControlPath('design/garment-isolated.png'), false);
  // Prefix similarity must not leak: `IssuesArchive/` is not `Issues/`.
  assert.equal(isControlPath('IssuesArchive/x.json'), false);
});

test('sync pushes only changed control files (hash-gated raw writes)', async () => {
  let workspaceDir = await makeWorkspace();
  try {
    let { client, writes } = makeFakeClient();
    let sync = new ControlPlaneSync({
      client,
      controlRealm: CONTROL_REALM,
      workspaceDir,
    });

    await mkdir(join(workspaceDir, 'Issues'), { recursive: true });
    await writeFile(join(workspaceDir, 'Issues', 'seed.json'), '{"a":1}');
    await writeFile(join(workspaceDir, 'run-log.gts'), 'export class X {}');
    // Product file — must never ride the control sync.
    await writeFile(join(workspaceDir, 'garment.gts'), 'export class G {}');

    let first = await sync.sync();
    assert.equal(first.ok, true);
    assert.deepEqual(first.pushed.sort(), ['Issues/seed.json', 'run-log.gts']);

    // Unchanged content — nothing goes over the wire.
    let second = await sync.sync();
    assert.equal(second.ok, true);
    assert.deepEqual(second.pushed, []);
    assert.equal(writes.length, 2);

    // Changed content — only the changed file re-pushes.
    await writeFile(join(workspaceDir, 'Issues', 'seed.json'), '{"a":2}');
    let third = await sync.sync();
    assert.deepEqual(third.pushed, ['Issues/seed.json']);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('pull fetches only control paths and seeds the hash gate', async () => {
  let workspaceDir = await makeWorkspace();
  try {
    let { client, writes } = makeFakeClient({
      'Issues/old-issue.json': '{"status":"done"}',
      'index.json': '{"product":"index — must not be pulled"}',
      'garment.gts': 'product module — must not be pulled',
    });
    let sync = new ControlPlaneSync({
      client,
      controlRealm: CONTROL_REALM,
      workspaceDir,
    });

    let pull = await sync.pull();
    assert.equal(pull.ok, true);
    assert.equal(pull.pulled, 1);
    let pulled = await readFile(
      join(workspaceDir, 'Issues', 'old-issue.json'),
      'utf8',
    );
    assert.equal(pulled, '{"status":"done"}');

    // The pulled file's hash is seeded — an immediate sync re-pushes nothing.
    let push = await sync.sync();
    assert.deepEqual(push.pushed, []);
    assert.equal(writes.length, 0);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('ensureControlPlaneIgnoreFile is idempotent and appends to user content', async () => {
  let workspaceDir = await makeWorkspace();
  try {
    await ensureControlPlaneIgnoreFile(workspaceDir);
    let content = await readFile(join(workspaceDir, '.boxelignore'), 'utf8');
    assert.match(content, /^\/Issues\/$/m);
    assert.match(content, /^\/Runs\/$/m);
    assert.match(content, /^\/run-log\.gts$/m);
    assert.match(content, /^\/\.boxelignore$/m);

    // Second call leaves the file untouched.
    await ensureControlPlaneIgnoreFile(workspaceDir);
    let again = await readFile(join(workspaceDir, '.boxelignore'), 'utf8');
    assert.equal(again, content);

    // A user-authored ignore file gets the block appended, not replaced.
    await writeFile(join(workspaceDir, '.boxelignore'), '/scratch/\n');
    await ensureControlPlaneIgnoreFile(workspaceDir);
    let merged = await readFile(join(workspaceDir, '.boxelignore'), 'utf8');
    assert.match(merged, /^\/scratch\/$/m);
    assert.match(merged, /^\/Issues\/$/m);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test('ensureControlPlaneIgnoreFile refreshes a STALE managed block', async () => {
  let workspaceDir = await makeWorkspace();
  try {
    // An older run wrote a control block that predates RunLogEntries — the
    // exact state that leaked entry cards into the product atomic sync (500).
    let stale = [
      '/scratch/',
      '',
      '# software-factory control-plane split',
      '/Issues/',
      '/Runs/',
      '/run-log.gts',
      '/.boxelignore',
      '',
    ].join('\n');
    await writeFile(join(workspaceDir, '.boxelignore'), stale);

    await ensureControlPlaneIgnoreFile(workspaceDir);
    let refreshed = await readFile(join(workspaceDir, '.boxelignore'), 'utf8');

    // The current CONTROL_DIRS set is now present…
    assert.match(
      refreshed,
      /^\/RunLogEntries\/$/m,
      'stale block refreshed to include RunLogEntries',
    );
    // …the user content is preserved…
    assert.match(refreshed, /^\/scratch\/$/m, 'user-authored lines kept');
    // …and the marker appears exactly once (no duplicate stacked block).
    let markerCount = (
      refreshed.match(/# software-factory control-plane split/g) || []
    ).length;
    assert.equal(markerCount, 1, 'no duplicate control-plane marker block');
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
