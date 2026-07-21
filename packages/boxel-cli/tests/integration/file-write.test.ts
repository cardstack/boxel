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
  createTestRealmViaCli,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';
import { TINY_PNG_BYTES, TINY_PDF_BYTES } from '../helpers/binary-fixtures.ts';

// `boxel file write <path> --realm <url>` reads content from STDIN (text)
// or `--file <local>` (binary). We drive the installed binary and verify
// the result by reading the file back from the realm with the profile the
// CLI wrote to disk — the action goes through the CLI, the assertion is a
// plain in-process fetch.

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;

async function readBack(relPath: string): Promise<Response> {
  return reloadProfile(home).authedRealmFetch(`${realmUrl}${relPath}`, {
    method: 'GET',
    headers: { Accept: 'application/vnd.card+source' },
  });
}

beforeAll(async () => {
  await startTestRealmServer();

  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);

  ({ realmUrl } = await createTestRealmViaCli(home));
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('file write (integration)', () => {
  it('writes a .gts file and can read it back from the realm', async () => {
    let source = 'export const hello = "world";';
    let res = await runBoxel(
      ['file', 'write', 'roundtrip.gts', '--realm', realmUrl],
      { home, input: source },
    );
    expect(res.ok, res.stderr).toBe(true);

    let response = await readBack('roundtrip.gts');
    expect(response.ok).toBe(true);
    let content = await response.text();
    expect(content).toContain('hello');
  });

  it('writes a .json card and can read it back', async () => {
    let card = JSON.stringify({
      data: {
        type: 'card',
        attributes: { title: 'Written Card' },
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });
    let res = await runBoxel(
      ['file', 'write', 'WrittenCard/1.json', '--realm', realmUrl],
      { home, input: card },
    );
    expect(res.ok, res.stderr).toBe(true);

    let response = await readBack('WrittenCard/1.json');
    expect(response.ok).toBe(true);
    let doc = await response.json();
    expect((doc as any).data.attributes.title).toBe('Written Card');
  });

  it('writes a PNG byte-identically and reads it back', async () => {
    // Binary content can't ride argv/stdin faithfully, so stage it in a
    // local file and pass `--file`, the CLI's binary path.
    let src = path.join(os.tmpdir(), `boxel-write-${Date.now()}.png`);
    fs.writeFileSync(src, Buffer.from(TINY_PNG_BYTES));
    try {
      let res = await runBoxel(
        ['file', 'write', 'image.png', '--realm', realmUrl, '--file', src],
        { home },
      );
      expect(res.ok, res.stderr).toBe(true);
    } finally {
      fs.rmSync(src, { force: true });
    }

    let response = await readBack('image.png');
    expect(response.ok).toBe(true);
    let remote = Buffer.from(await response.arrayBuffer());
    expect(remote.equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);
  });

  it('writes a PDF byte-identically', async () => {
    let src = path.join(os.tmpdir(), `boxel-write-${Date.now()}.pdf`);
    fs.writeFileSync(src, Buffer.from(TINY_PDF_BYTES));
    try {
      let res = await runBoxel(
        ['file', 'write', 'doc.pdf', '--realm', realmUrl, '--file', src],
        { home },
      );
      expect(res.ok, res.stderr).toBe(true);
    } finally {
      fs.rmSync(src, { force: true });
    }

    let response = await readBack('doc.pdf');
    let remote = Buffer.from(await response.arrayBuffer());
    expect(remote.equals(Buffer.from(TINY_PDF_BYTES))).toBe(true);
  });

  it('exits non-zero with a clear error when there is no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    try {
      let res = await runBoxel(
        ['file', 'write', 'test.gts', '--realm', realmUrl],
        { home: emptyHome, input: 'content' },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
