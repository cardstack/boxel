import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';
import { TINY_PNG_BYTES, NON_UTF8_BYTES } from '../helpers/binary-fixtures.ts';

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

// The prefix the fixture server registers for the test realm, so the realm is
// in the prefix map the server serves and the CLI can resolve it the way it
// resolves `@cardstack/skills/` against a deployed server.
const TEST_REALM_PREFIX = '@cli-test/test/';

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
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  await startTestRealmServer({
    fileSystem: {
      'file-read-check.gts': SOURCE_GTS,
      'test-card.json': SOURCE_JSON,
    },
    realmPrefixes: { [TEST_REALM_PREFIX]: realmUrl },
  });

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

  it('reads a file via a prefix-form realm identifier the server serves', async () => {
    // The prefix resolves through the map the active profile's realm server
    // serves at `/_prefix-realms`, where the fixture registered it.
    let res = await runBoxel(
      [
        'file',
        'read',
        'test-card.json',
        '--realm',
        TEST_REALM_PREFIX,
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

  it('returns a not-ok result for a prefix the realm server does not serve', async () => {
    // No URL is derived from the prefix's spelling: a prefix absent from the
    // served map is refused, and the error names the prefixes that are served.
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
    expect(result.error).toContain('no registered realm prefix matches');
    expect(result.error).toContain(TEST_REALM_PREFIX);
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

  it('reads a .zip byte-identically (returns bytes, not content)', async () => {
    // A text-path read would UTF-8-decode the payload and mangle its invalid
    // sequences into U+FFFD, so recovering the bytes intact is the proof that
    // application/zip is read as bytes.
    let zipUrl = `${realmUrl}archive.zip`;
    let seed = await reloadProfile(home).authedRealmFetch(zipUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: NON_UTF8_BYTES,
    });
    expect(seed.ok, `seed POST failed: ${seed.status}`).toBe(true);

    let res = await runBoxel(
      ['file', 'read', 'archive.zip', '--realm', realmUrl, '--json'],
      { home },
    );
    let result = res.json<ReadJson>();
    expect(result.ok).toBe(true);
    expect(result.content).toBeUndefined();
    expect(result.bytesBase64).toBeDefined();
    let bytes = Buffer.from(result.bytesBase64!, 'base64');
    expect(bytes.equals(Buffer.from(NON_UTF8_BYTES))).toBe(true);
  });

  it('reads a card by its extensionless id as text, not bytes', async () => {
    // Card ids carry no extension — the realm resolves `test-card` to
    // `test-card.json` and serves it as JSON. Classifying by the requested
    // name would call it binary and hand back base64, so this pins that the
    // served content type is what decides.
    let res = await runBoxel(
      ['file', 'read', 'test-card', '--realm', realmUrl, '--json'],
      { home },
    );
    let result = res.json<ReadJson>();

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.bytesBase64).toBeUndefined();
    expect(result.content).toBeTruthy();
    expect(JSON.parse(result.content!)).toHaveProperty('data');
  });

  it('reads a module by a dotted extensionless name as text', async () => {
    // `hello.test` resolves through the executable-extension fallback to
    // `hello.test.gts`; `.test` is not a textual extension on its own.
    let seed = await reloadProfile(home).authedRealmFetch(
      `${realmUrl}hello.test.gts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.card+source' },
        body: 'export const hello = "world";\n',
      },
    );
    expect(seed.ok, `seed POST failed: ${seed.status}`).toBe(true);

    let res = await runBoxel(
      ['file', 'read', 'hello.test', '--realm', realmUrl, '--json'],
      { home },
    );
    let result = res.json<ReadJson>();

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.bytesBase64).toBeUndefined();
    expect(result.content).toContain('hello');
  });

  it('returns error result when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
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
