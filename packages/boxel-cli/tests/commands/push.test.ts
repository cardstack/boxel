import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createRealmState,
  type RealmServerState,
} from '../helpers/mock-realm-server.js';
import { createMockFetch, type FetchCall } from '../helpers/mock-fetch.js';
import { TEST_REALM_URL } from '../helpers/mock-credentials.js';

const mockCredentials = vi.hoisted(() => ({
  matrixUrl: 'https://matrix.test.local/',
  username: 'testuser',
  password: 'testpassword',
}));

vi.mock('../../src/lib/realm-sync-base.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    validateMatrixEnvVars: vi.fn().mockResolvedValue(mockCredentials),
  };
});

vi.mock('../../src/lib/checkpoint-manager.js', () => ({
  CheckpointManager: vi.fn().mockImplementation(() => ({
    createCheckpoint: vi.fn().mockReturnValue({
      shortHash: 'abc1234',
      message: 'test checkpoint',
      isMajor: false,
    }),
  })),
}));

// @ts-expect-error vitest supports top-level await even in CJS mode
const { pushCommand } = await import('../../src/commands/push.js');

describe('push integration', () => {
  let tmpDir: string;
  let realmState: RealmServerState;
  let calls: FetchCall[];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(process.env.TMPDIR || '/tmp', 'boxel-push-test-'),
    );
    originalFetch = globalThis.fetch;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(
      (code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${code})`);
      },
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.mocked(console.log).mockRestore?.();
    vi.mocked(console.error).mockRestore?.();
    vi.mocked(console.warn).mockRestore?.();
    vi.mocked(process.exit).mockRestore?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupFetch(
    state: RealmServerState,
    onRequest?: (url: string, method: string) => void,
  ) {
    const result = createMockFetch({ realmState: state, onRequest });
    calls = result.calls;
    globalThis.fetch = result.mockFetch;
    return result;
  }

  function writeLocalFile(localDir: string, relPath: string, content: string) {
    const fullPath = path.join(localDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  it('pushes local files to empty remote', async () => {
    realmState = createRealmState({});
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    writeLocalFile(
      localDir,
      'BlogPost/hello.json',
      '{"data":{"attributes":{"title":"Hello"}}}',
    );
    writeLocalFile(
      localDir,
      'my-card.gts',
      'export class MyCard extends CardDef {}',
    );

    await pushCommand(localDir, TEST_REALM_URL, {});

    expect(realmState.files.has('BlogPost/hello.json')).toBe(true);
    expect(realmState.files.get('BlogPost/hello.json')?.content).toBe(
      '{"data":{"attributes":{"title":"Hello"}}}',
    );
    expect(realmState.files.has('my-card.gts')).toBe(true);

    const postCalls = calls.filter(
      (c) =>
        c.method === 'POST' &&
        !c.url.includes('_session') &&
        !c.url.includes('_matrix'),
    );
    expect(postCalls.length).toBe(2);

    expect(fs.existsSync(path.join(localDir, '.boxel-sync.json'))).toBe(true);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(localDir, '.boxel-sync.json'), 'utf-8'),
    );
    expect(manifest.workspaceUrl).toBe(TEST_REALM_URL);
    expect(Object.keys(manifest.files).length).toBe(2);
  });

  it('incremental push skips unchanged files', async () => {
    realmState = createRealmState({});
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    writeLocalFile(
      localDir,
      'BlogPost/hello.json',
      '{"data":{"attributes":{"title":"Hello"}}}',
    );
    writeLocalFile(
      localDir,
      'BlogPost/world.json',
      '{"data":{"attributes":{"title":"World"}}}',
    );

    await pushCommand(localDir, TEST_REALM_URL, {});

    writeLocalFile(
      localDir,
      'BlogPost/hello.json',
      '{"data":{"attributes":{"title":"Hello Updated"}}}',
    );

    const result2 = createMockFetch({ realmState });
    calls = result2.calls;
    globalThis.fetch = result2.mockFetch;

    await pushCommand(localDir, TEST_REALM_URL, {});

    const postCalls = calls.filter(
      (c) =>
        c.method === 'POST' &&
        !c.url.includes('_session') &&
        !c.url.includes('_matrix'),
    );
    expect(postCalls.length).toBe(1);
    expect(postCalls[0].url).toContain('hello.json');
  });

  it('push with --force uploads all files regardless of manifest', async () => {
    realmState = createRealmState({});
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    writeLocalFile(localDir, 'BlogPost/hello.json', '{"title":"Hello"}');
    writeLocalFile(localDir, 'BlogPost/world.json', '{"title":"World"}');

    await pushCommand(localDir, TEST_REALM_URL, {});

    const result2 = createMockFetch({ realmState });
    calls = result2.calls;
    globalThis.fetch = result2.mockFetch;

    await pushCommand(localDir, TEST_REALM_URL, { force: true });

    const postCalls = calls.filter(
      (c) =>
        c.method === 'POST' &&
        !c.url.includes('_session') &&
        !c.url.includes('_matrix'),
    );
    expect(postCalls.length).toBe(2);
  });

  it('push with --delete removes remote-only files', async () => {
    realmState = createRealmState({
      'BlogPost/old.json': { content: '{"title":"Old"}' },
      'BlogPost/orphan.json': { content: '{"title":"Orphan"}' },
    });
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    writeLocalFile(localDir, 'BlogPost/hello.json', '{"title":"Hello"}');

    await pushCommand(localDir, TEST_REALM_URL, { delete: true });

    expect(realmState.files.has('BlogPost/hello.json')).toBe(true);
    expect(realmState.files.has('BlogPost/old.json')).toBe(false);
    expect(realmState.files.has('BlogPost/orphan.json')).toBe(false);

    const deleteCalls = calls.filter((c) => c.method === 'DELETE');
    expect(deleteCalls.length).toBe(2);
  });

  it('push with --dry-run makes no POST or DELETE calls', async () => {
    realmState = createRealmState({
      'BlogPost/orphan.json': { content: '{"title":"Orphan"}' },
    });
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    writeLocalFile(localDir, 'BlogPost/hello.json', '{"title":"Hello"}');

    await pushCommand(localDir, TEST_REALM_URL, { dryRun: true });

    const filePostCalls = calls.filter(
      (c) =>
        c.method === 'POST' &&
        !c.url.includes('_session') &&
        !c.url.includes('_matrix'),
    );
    expect(filePostCalls.length).toBe(0);

    const deleteCalls = calls.filter((c) => c.method === 'DELETE');
    expect(deleteCalls.length).toBe(0);

    expect(realmState.files.has('BlogPost/orphan.json')).toBe(true);

    expect(fs.existsSync(path.join(localDir, '.boxel-sync.json'))).toBe(false);
  });

  it('push with upload error still uploads other files', async () => {
    realmState = createRealmState({});
    realmState.failingPaths = new Set(['BlogPost/broken.json']);
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    writeLocalFile(localDir, 'BlogPost/good.json', '{"title":"Good"}');
    writeLocalFile(localDir, 'BlogPost/broken.json', '{"title":"Broken"}');

    await expect(pushCommand(localDir, TEST_REALM_URL, {})).rejects.toThrow(
      /process\.exit/,
    );

    expect(realmState.files.has('BlogPost/good.json')).toBe(true);
    expect(realmState.files.has('BlogPost/broken.json')).toBe(false);
  });

  it('push ignores .boxel-sync.json', async () => {
    realmState = createRealmState({});
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    writeLocalFile(localDir, 'BlogPost/hello.json', '{"title":"Hello"}');
    writeLocalFile(
      localDir,
      '.boxel-sync.json',
      '{"workspaceUrl":"test","files":{}}',
    );

    await pushCommand(localDir, TEST_REALM_URL, {});

    expect(realmState.files.has('.boxel-sync.json')).toBe(false);
    expect(realmState.files.has('BlogPost/hello.json')).toBe(true);
  });
});
