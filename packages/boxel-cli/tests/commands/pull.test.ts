import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createRealmState,
  type RealmServerState,
} from '../helpers/mock-realm-server.js';
import { createMockFetch } from '../helpers/mock-fetch.js';
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
const { pullCommand } = await import('../../src/commands/pull.js');

describe('pull integration', () => {
  let tmpDir: string;
  let realmState: RealmServerState;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(process.env.TMPDIR || '/tmp', 'boxel-pull-test-'),
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
    globalThis.fetch = result.mockFetch;
    return result;
  }

  it('pulls 3 files into empty directory', async () => {
    realmState = createRealmState({
      'BlogPost/hello.json': {
        content: '{"data":{"attributes":{"title":"Hello"}}}',
      },
      'BlogPost/world.json': {
        content: '{"data":{"attributes":{"title":"World"}}}',
      },
      'my-card.gts': {
        content: 'export class MyCard extends CardDef {}',
      },
    });
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    await pullCommand(TEST_REALM_URL, localDir, {});

    expect(fs.existsSync(path.join(localDir, 'BlogPost', 'hello.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(localDir, 'BlogPost', 'world.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(localDir, 'my-card.gts'))).toBe(true);

    expect(
      fs.readFileSync(path.join(localDir, 'BlogPost', 'hello.json'), 'utf-8'),
    ).toBe('{"data":{"attributes":{"title":"Hello"}}}');
    expect(fs.readFileSync(path.join(localDir, 'my-card.gts'), 'utf-8')).toBe(
      'export class MyCard extends CardDef {}',
    );
  });

  it('preserves local-only files without --delete', async () => {
    realmState = createRealmState({
      'BlogPost/hello.json': {
        content: '{"data":{"attributes":{"title":"Hello"}}}',
      },
    });
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(path.join(localDir, 'Notes'), { recursive: true });
    fs.writeFileSync(
      path.join(localDir, 'Notes', 'local-only.json'),
      '{"local":"only"}',
    );

    await pullCommand(TEST_REALM_URL, localDir, {});

    expect(fs.existsSync(path.join(localDir, 'BlogPost', 'hello.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(localDir, 'Notes', 'local-only.json'))).toBe(
      true,
    );
  });

  it('with --delete removes local-only files', async () => {
    realmState = createRealmState({
      'BlogPost/hello.json': {
        content: '{"data":{"attributes":{"title":"Hello"}}}',
      },
    });
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(path.join(localDir, 'Notes'), { recursive: true });
    fs.writeFileSync(
      path.join(localDir, 'Notes', 'local-only.json'),
      '{"local":"only"}',
    );

    await pullCommand(TEST_REALM_URL, localDir, { delete: true });

    expect(fs.existsSync(path.join(localDir, 'BlogPost', 'hello.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(localDir, 'Notes', 'local-only.json'))).toBe(
      false,
    );
  });

  it('with --dry-run writes no files', async () => {
    realmState = createRealmState({
      'BlogPost/hello.json': {
        content: '{"data":{"attributes":{"title":"Hello"}}}',
      },
    });
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(localDir, { recursive: true });

    await pullCommand(TEST_REALM_URL, localDir, { dryRun: true });

    const entries = fs.readdirSync(localDir);
    expect(entries).toEqual([]);
  });

  it('with one file returning 500 still downloads others', async () => {
    realmState = createRealmState({
      'BlogPost/good.json': {
        content: '{"data":{"attributes":{"title":"Good"}}}',
      },
      'BlogPost/broken.json': { content: 'broken' },
    });
    realmState.failingPaths = new Set(['BlogPost/broken.json']);
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');

    await expect(pullCommand(TEST_REALM_URL, localDir, {})).rejects.toThrow(
      /process\.exit/,
    );

    expect(fs.existsSync(path.join(localDir, 'BlogPost', 'good.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(localDir, 'BlogPost', 'broken.json'))).toBe(
      false,
    );
  });

  it('pulls subdirectories recursively', async () => {
    realmState = createRealmState({
      'BlogPost/hello.json': { content: '{"title":"Hello"}' },
      'BlogPost/drafts/draft1.json': { content: '{"title":"Draft"}' },
      'Author/author1.json': { content: '{"name":"Author"}' },
    });
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    await pullCommand(TEST_REALM_URL, localDir, {});

    expect(fs.existsSync(path.join(localDir, 'BlogPost', 'hello.json'))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(localDir, 'BlogPost', 'drafts', 'draft1.json')),
    ).toBe(true);
    expect(fs.existsSync(path.join(localDir, 'Author', 'author1.json'))).toBe(
      true,
    );
  });

  it('pulls index.json', async () => {
    realmState = createRealmState({
      'index.json': { content: '{"data":{"id":"test"}}' },
    });
    setupFetch(realmState);

    const localDir = path.join(tmpDir, 'workspace');
    await pullCommand(TEST_REALM_URL, localDir, {});

    expect(fs.existsSync(path.join(localDir, 'index.json'))).toBe(true);
    expect(fs.readFileSync(path.join(localDir, 'index.json'), 'utf-8')).toBe(
      '{"data":{"id":"test"}}',
    );
  });
});
