import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';
import { TINY_PNG_BYTES } from '../helpers/binary-fixtures.ts';

// `boxel file read <path> [--realm <url>] --json` prints
// `{ ok, status, error?, content?, bytesBase64? }` on stdout. We drive the
// installed binary and parse its JSON payload.

interface ReadJson {
  ok: boolean;
  status?: number;
  content?: string;
  bytesBase64?: string;
  error?: string;
}

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;

const SOURCE_GTS = `import {
  CardDef,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class FileReadCheck extends CardDef {
  static displayName = 'File Read Check';
  @field label = contains(StringField);
}
`;

const SOURCE_JSON = JSON.stringify(
  {
    data: {
      type: 'card',
      attributes: { title: 'Test Card' },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/card-api',
          name: 'CardDef',
        },
      },
    },
  },
  null,
  2,
);

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: {
      'file-read-check.gts': SOURCE_GTS,
      'test-card.json': SOURCE_JSON,
    },
  });

  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;

  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('file read (integration)', () => {
  it('reads a .json file and returns raw text content', async () => {
    let res = await runBoxel(
      ['file', 'read', 'test-card.json', '--realm', realmUrl, '--json'],
      { home },
    );
    let result = res.json<ReadJson>();

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toBeTruthy();
    expect(typeof result.content).toBe('string');
    // Caller can parse JSON themselves
    let parsed = JSON.parse(result.content!);
    expect(parsed).toHaveProperty('data');
  });

  it('reads a .gts file and returns raw text content', async () => {
    let res = await runBoxel(
      ['file', 'read', 'file-read-check.gts', '--realm', realmUrl, '--json'],
      { home },
    );
    let result = res.json<ReadJson>();

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toBeTruthy();
    expect(result.content!.length).toBeGreaterThan(0);
  });

  it('reads a file via a non-URL @cardstack/ realm identifier', async () => {
    // `@cardstack/<realm>/` resolves against the active profile's
    // realm-server URL, so `@cardstack/test/` names the test realm.
    let res = await runBoxel(
      [
        'file',
        'read',
        'test-card.json',
        '--realm',
        '@cardstack/test/',
        '--json',
      ],
      { home },
    );
    let result = res.json<ReadJson>();

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    let parsed = JSON.parse(result.content!);
    expect(parsed).toHaveProperty('data');
  });

  it('returns a not-ok result for an unsupported realm identifier scope', async () => {
    let res = await runBoxel(
      [
        'file',
        'read',
        'test-card.json',
        '--realm',
        '@unknown-scope/test/',
        '--json',
      ],
      { home },
    );
    expect(res.exitCode).toBe(1);
    let result = res.json<ReadJson>();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('only @cardstack/<realm>/');
  });

  it('returns a not-ok result with 404 status for a nonexistent file', async () => {
    let res = await runBoxel(
      ['file', 'read', 'does-not-exist.json', '--realm', realmUrl, '--json'],
      { home },
    );
    expect(res.exitCode).toBe(1);
    let result = res.json<ReadJson>();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
  });

  it('reads a binary PNG byte-identically (returns bytes, not content)', async () => {
    // Seed via direct octet-stream POST (setup stays in-process) —
    // startTestRealmServer's fileSystem option only accepts strings.
    let pngUrl = `${realmUrl}image.png`;
    let seed = await reloadProfile(home).authedRealmFetch(pngUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: TINY_PNG_BYTES,
    });
    expect(seed.ok, `seed POST failed: ${seed.status}`).toBe(true);

    let res = await runBoxel(
      ['file', 'read', 'image.png', '--realm', realmUrl, '--json'],
      { home },
    );
    let result = res.json<ReadJson>();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toBeUndefined();
    expect(result.bytesBase64).toBeDefined();
    let bytes = Buffer.from(result.bytesBase64!, 'base64');
    expect(bytes.equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);
  });

  it('returns error result when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(
        ['file', 'read', 'test-card.json', '--realm', realmUrl, '--json'],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      let result = res.json<ReadJson>();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
