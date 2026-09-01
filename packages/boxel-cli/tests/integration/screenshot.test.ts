import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'node:crypto';
import type {
  Prerenderer,
  ScreenshotPrerenderResponse,
} from '@cardstack/runtime-common';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';
import { TINY_PNG_BYTES } from '../helpers/binary-fixtures.ts';

// Drives `boxel screenshot` end-to-end through the real realm server, queue,
// and screenshot-card worker task. The prerenderer is a stub that returns a
// fixed PNG per requested capture, so no Chrome is involved; what's under
// test is the CLI's request construction, auth, response handling, file
// writing, and manifest/exit-code contract.

const TINY_PNG_BASE64 = Buffer.from(TINY_PNG_BYTES).toString('base64');
const TINY_PNG_SHA256 = createHash('sha256')
  .update(TINY_PNG_BYTES)
  .digest('hex');

const screenshotStubPrerenderer: Prerenderer = {
  prerenderModule: async () => ({ html: '', status: 200 }) as any,
  prerenderVisit: async () => ({}) as any,
  runCommand: async () => ({ status: 'ready' }),
  prerenderScreenshot: async (args): Promise<ScreenshotPrerenderResponse> => {
    let entries = args.captureSpec?.captures ?? [{ name: 'default' }];
    let captures = entries.map((entry: any) => ({
      name: entry.name ?? 'default',
      base64: TINY_PNG_BASE64,
      width: entry.viewport?.width ?? 800,
      height: entry.viewport?.height ?? 600,
      deviceScaleFactor: entry.deviceScaleFactor ?? 1,
    }));
    return {
      status: 'ready',
      captures,
      base64: captures[0].base64,
      width: captures[0].width,
      height: captures[0].height,
      contentType: 'image/png',
    };
  },
};

const CARD_JSON = JSON.stringify({
  data: {
    type: 'card',
    attributes: { title: 'Screenshot Target' },
    meta: {
      adoptsFrom: { module: '@cardstack/base/card-api', name: 'CardDef' },
    },
  },
});

interface ManifestJson {
  ok: boolean;
  error?: string;
  captures: {
    card: string;
    name: string | null;
    status: string;
    file?: string;
    width?: number | null;
    height?: number | null;
    sha256?: string;
    url: string | null;
    error?: string;
  }[];
  manifestPath?: string;
}

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;
let cardUrl: string;

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: { 'screenshot-target.json': CARD_JSON },
    prerenderer: screenshotStubPrerenderer,
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  cardUrl = `${realmUrl}screenshot-target`;

  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
}, 60_000);

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

function tempOutDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-screenshot-out-'));
}

describe('screenshot (integration)', () => {
  it('captures a card and writes the image with a manifest entry', async () => {
    let out = tempOutDir();
    let res = await runBoxel(['screenshot', cardUrl, '--out', out, '--json'], {
      home,
    });
    let result = res.json<ManifestJson>();

    expect(result.ok, `screenshot failed: ${JSON.stringify(result)}`).toBe(
      true,
    );
    expect(res.exitCode).toBe(0);
    expect(result.captures).toHaveLength(1);
    let entry = result.captures[0];
    expect(entry.status).toBe('ok');
    expect(entry.card).toBe(cardUrl);
    expect(entry.sha256).toBe(TINY_PNG_SHA256);
    expect(entry.file).toBeTruthy();
    expect(new Uint8Array(fs.readFileSync(entry.file!))).toEqual(
      TINY_PNG_BYTES,
    );
  });

  it('runs a --spec batch and writes named files plus screenshot-manifest.json', async () => {
    let out = tempOutDir();
    let specPath = path.join(out, 'captures.json');
    fs.writeFileSync(
      specPath,
      JSON.stringify([
        {
          card: cardUrl,
          captureSpec: {
            captures: [
              { name: 'wide', viewport: { width: 1280, height: 800 } },
              { name: 'thumb', viewport: { width: 200, height: 200 } },
            ],
          },
        },
      ]),
    );

    let res = await runBoxel(
      ['screenshot', '--spec', specPath, '--out', out, '--json'],
      { home },
    );
    let result = res.json<ManifestJson>();

    expect(result.ok, `batch failed: ${JSON.stringify(result)}`).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(result.captures.map((c) => c.name)).toEqual(['wide', 'thumb']);
    expect(result.captures.map((c) => c.width)).toEqual([1280, 200]);
    for (let entry of result.captures) {
      expect(entry.sha256).toBe(TINY_PNG_SHA256);
      expect(new Uint8Array(fs.readFileSync(entry.file!))).toEqual(
        TINY_PNG_BYTES,
      );
    }

    let manifest = JSON.parse(
      fs.readFileSync(path.join(out, 'screenshot-manifest.json'), 'utf8'),
    ) as ManifestJson;
    expect(manifest.ok).toBe(true);
    expect(manifest.captures).toHaveLength(2);
  });

  it('surfaces a server-side capture-spec rejection and exits non-zero', async () => {
    let out = tempOutDir();
    let specPath = path.join(out, 'captures.json');
    fs.writeFileSync(
      specPath,
      JSON.stringify({ card: cardUrl, captureSpec: { bogus: true } }),
    );

    let res = await runBoxel(
      ['screenshot', '--spec', specPath, '--out', out, '--json'],
      { home },
    );
    let result = res.json<ManifestJson>();

    expect(res.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.captures[0].status).toBe('error');
    expect(result.captures[0].error).toContain('bogus');
  });

  it('reports a missing card as an error and exits non-zero', async () => {
    let res = await runBoxel(
      ['screenshot', `${realmUrl}no-such-card`, '--json'],
      { home },
    );
    let result = res.json<ManifestJson>();

    expect(res.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.captures[0].error).toContain('HTTP 404');
  });
});
