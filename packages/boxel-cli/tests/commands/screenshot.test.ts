import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  captureSpecFromFlags,
  registerScreenshotCommand,
  screenshot,
} from '../../src/commands/screenshot.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';

const REALM_URL = 'http://realms.example.test/owner/workspace/';
const CARD_URL = `${REALM_URL}Person/fadhlan`;
const ENDPOINT = 'http://realms.example.test/_screenshot-card';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: unknown;
}

/**
 * Fake authenticator standing in for both the per-realm fetches (card
 * discovery GET, image download GET) and — via the command's injected-mode
 * fallback — the realm-server POST. Routes by method + URL.
 */
function makeFake(options: {
  realmHeader?: string | null;
  cardStatus?: number;
  postResponses: (() => Response)[];
  downloads?: Record<string, Response>;
}): { authenticator: RealmAuthenticator; requests: RecordedRequest[] } {
  let requests: RecordedRequest[] = [];
  let postIndex = 0;
  return {
    requests,
    authenticator: {
      async authedRealmFetch(input, init) {
        let url = typeof input === 'string' ? input : input.toString();
        let headers = new Headers(init?.headers);
        let method = init?.method ?? 'GET';
        requests.push({
          url,
          method,
          headers,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        if (method === 'POST') {
          let make = options.postResponses[postIndex];
          postIndex = Math.min(postIndex + 1, options.postResponses.length - 1);
          return make();
        }
        if (options.downloads && url in options.downloads) {
          return options.downloads[url];
        }
        // Card discovery GET
        let responseHeaders = new Headers();
        let realmHeader =
          options.realmHeader === undefined ? REALM_URL : options.realmHeader;
        if (realmHeader) {
          responseHeaders.set('x-boxel-realm-url', realmHeader);
        }
        return new Response('{}', {
          status: options.cardStatus ?? 200,
          headers: responseHeaders,
        });
      },
    },
  };
}

function readyResponse(attrs: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      data: { type: 'screenshot-card-result', attributes: attrs },
    }),
    { status: 201, headers: { 'Content-Type': 'application/vnd.api+json' } },
  );
}

const PNG_BYTES = Buffer.from('fake-png-bytes');
const PNG_BASE64 = PNG_BYTES.toString('base64');
const PNG_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex');

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'boxel-screenshot-test-'));
}

describe('boxel screenshot: single capture', () => {
  it('discovers the realm, posts a canonical request, and writes the image from base64', async () => {
    let { authenticator, requests } = makeFake({
      postResponses: [
        () =>
          readyResponse({
            status: 'ready',
            base64: PNG_BASE64,
            width: 800,
            height: 600,
            contentType: 'image/png',
            captures: [
              {
                name: null,
                url: `${REALM_URL}_screenshot/Person/fadhlan`,
                width: 800,
                height: 600,
                deviceScaleFactor: null,
                base64: PNG_BASE64,
              },
            ],
          }),
      ],
    });
    let out = tempDir();
    let result = await screenshot(`${CARD_URL}.json`, { authenticator, out });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.captures).toHaveLength(1);
    let entry = result.captures[0];
    expect(entry.status).toBe('ok');
    expect(entry.name).toBeNull();
    expect(entry.url).toBe(`${REALM_URL}_screenshot/Person/fadhlan`);
    expect(entry.width).toBe(800);
    expect(entry.sha256).toBe(PNG_SHA256);
    expect(entry.file).toBe(join(out, 'Person-fadhlan.png'));
    expect(readFileSync(entry.file!)).toEqual(PNG_BYTES);

    // Discovery GET (instance source file) then the POST.
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe(`${CARD_URL}.json`);
    expect(requests[0].headers.get('Accept')).toBe(
      'application/vnd.card+source',
    );
    expect(requests[1].method).toBe('POST');
    expect(requests[1].url).toBe(ENDPOINT);
    expect(requests[1].body).toEqual({
      data: {
        type: 'screenshot-card',
        attributes: {
          realmURL: REALM_URL,
          cardId: CARD_URL,
          format: 'isolated',
          includeBase64: true,
          captureSpec: null,
        },
      },
    });
  });

  it('passes the capture spec through verbatim (including target)', async () => {
    let { authenticator, requests } = makeFake({
      postResponses: [
        () =>
          readyResponse({
            status: 'ready',
            captures: [
              {
                name: 'default',
                url: null,
                width: 400,
                height: 300,
                deviceScaleFactor: 2,
                base64: PNG_BASE64,
              },
            ],
          }),
      ],
    });
    let spec = {
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      target: '[data-card-field="avatar"]',
    };
    let result = await screenshot(CARD_URL, {
      authenticator,
      out: tempDir(),
      captureSpec: spec,
    });
    expect(result.ok).toBe(true);
    let post = requests.find((r) => r.method === 'POST')!;
    expect((post.body as any).data.attributes.captureSpec).toEqual(spec);
  });

  it('skips discovery when --realm is given and rejects a card outside it', async () => {
    let { authenticator, requests } = makeFake({
      postResponses: [
        () =>
          readyResponse({
            status: 'ready',
            captures: [
              {
                name: null,
                url: null,
                width: 1,
                height: 1,
                deviceScaleFactor: null,
                base64: PNG_BASE64,
              },
            ],
          }),
      ],
    });
    let result = await screenshot(CARD_URL, {
      authenticator,
      out: tempDir(),
      realm: REALM_URL,
    });
    expect(result.ok).toBe(true);
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(0);

    let outside = await screenshot('http://elsewhere.test/Person/1', {
      authenticator,
      out: tempDir(),
      realm: REALM_URL,
    });
    expect(outside.ok).toBe(false);
    expect(outside.captures[0].error).toContain('not within --realm');
  });

  it('downloads from the served URL when the response carries no base64', async () => {
    let servedUrl = `${REALM_URL}_screenshot/Person/fadhlan`;
    let { authenticator } = makeFake({
      postResponses: [
        () =>
          readyResponse({
            status: 'ready',
            captures: [
              {
                name: null,
                url: servedUrl,
                width: 800,
                height: 600,
                deviceScaleFactor: null,
              },
            ],
          }),
      ],
      downloads: {
        [servedUrl]: new Response(PNG_BYTES, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      },
    });
    let result = await screenshot(CARD_URL, {
      authenticator,
      out: tempDir(),
    });
    expect(result.ok).toBe(true);
    expect(result.captures[0].sha256).toBe(PNG_SHA256);
  });

  it('reports the server error body on a non-ok POST', async () => {
    let { authenticator } = makeFake({
      postResponses: [
        () =>
          new Response(
            JSON.stringify({
              errors: ['captureSpec.target is not a supported field'],
            }),
            { status: 400 },
          ),
      ],
    });
    let result = await screenshot(CARD_URL, {
      authenticator,
      out: tempDir(),
      captureSpec: { target: '.foo' },
    });
    expect(result.ok).toBe(false);
    expect(result.captures[0].status).toBe('error');
    expect(result.captures[0].error).toContain('HTTP 400');
    expect(result.captures[0].error).toContain('target is not a supported');
  });

  it('reports a job error when the card cannot be loaded', async () => {
    let { authenticator } = makeFake({
      cardStatus: 404,
      postResponses: [],
    });
    let result = await screenshot(CARD_URL, {
      authenticator,
      out: tempDir(),
    });
    expect(result.ok).toBe(false);
    expect(result.captures[0].error).toContain('HTTP 404');
  });
});

describe('boxel screenshot: busy-server retry', () => {
  it('honors Retry-After and succeeds on the retry', async () => {
    let sleeps: number[] = [];
    let { authenticator, requests } = makeFake({
      postResponses: [
        () =>
          new Response(null, {
            status: 503,
            headers: { 'retry-after': '2' },
          }),
        () =>
          readyResponse({
            status: 'ready',
            captures: [
              {
                name: null,
                url: null,
                width: 1,
                height: 1,
                deviceScaleFactor: null,
                base64: PNG_BASE64,
              },
            ],
          }),
      ],
    });
    let result = await screenshot(CARD_URL, {
      authenticator,
      out: tempDir(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.ok).toBe(true);
    expect(sleeps).toEqual([2000]);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2);
  });

  it('gives up when the Retry-After wait would exceed --max-wait', async () => {
    let { authenticator } = makeFake({
      postResponses: [
        () =>
          new Response(null, {
            status: 503,
            headers: { 'retry-after': '30' },
          }),
      ],
    });
    let result = await screenshot(CARD_URL, {
      authenticator,
      out: tempDir(),
      maxWaitMs: 5000,
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
    expect(result.captures[0].error).toContain('Server busy');
  });
});

describe('boxel screenshot: --url-only', () => {
  it('requests no base64 and reports served URLs; a null URL is an error', async () => {
    let servedUrl = `${REALM_URL}_screenshot/Person/fadhlan`;
    let { authenticator, requests } = makeFake({
      postResponses: [
        () =>
          readyResponse({
            status: 'ready',
            captures: [
              {
                name: 'wide',
                url: servedUrl,
                width: 1280,
                height: 800,
                deviceScaleFactor: null,
              },
              {
                name: 'thumb',
                url: null,
                width: 200,
                height: 200,
                deviceScaleFactor: null,
              },
            ],
          }),
      ],
    });
    let result = await screenshot(CARD_URL, {
      authenticator,
      urlOnly: true,
      captureSpec: {
        captures: [{ name: 'wide' }, { name: 'thumb' }],
      },
    });
    let post = requests.find((r) => r.method === 'POST')!;
    expect((post.body as any).data.attributes.includeBase64).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.captures[0]).toMatchObject({
      name: 'wide',
      status: 'ok',
      url: servedUrl,
    });
    expect(result.captures[1]).toMatchObject({
      name: 'thumb',
      status: 'error',
    });
    expect(result.captures[1].error).toContain('No served URL');
  });
});

describe('boxel screenshot: --spec batch', () => {
  it('posts once per card, writes named files, and writes a manifest', async () => {
    let { authenticator, requests } = makeFake({
      postResponses: [
        () =>
          readyResponse({
            status: 'ready',
            captures: [
              {
                name: 'wide',
                url: null,
                width: 1280,
                height: 800,
                deviceScaleFactor: 1,
                base64: PNG_BASE64,
              },
              {
                name: 'thumb',
                url: null,
                width: 200,
                height: 200,
                deviceScaleFactor: 1,
                base64: PNG_BASE64,
              },
            ],
          }),
      ],
    });
    let out = tempDir();
    let specPath = join(out, 'captures.json');
    writeFileSync(
      specPath,
      JSON.stringify([
        {
          card: CARD_URL,
          captureSpec: {
            captures: [
              { name: 'wide', viewport: { width: 1280, height: 800 } },
              { name: 'thumb', clip: { x: 0, y: 0, width: 200, height: 200 } },
            ],
          },
        },
        { card: `${REALM_URL}Person/second`, format: 'embedded' },
      ]),
    );

    let result = await screenshot(undefined, {
      authenticator,
      out,
      specPath,
    });
    expect(result.ok).toBe(true);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2);
    let posts = requests.filter((r) => r.method === 'POST');
    expect((posts[1].body as any).data.attributes.format).toBe('embedded');

    expect(result.captures.map((c) => c.file)).toEqual([
      join(out, 'Person-fadhlan--wide.png'),
      join(out, 'Person-fadhlan--thumb.png'),
      join(out, 'Person-second--wide.png'),
      join(out, 'Person-second--thumb.png'),
    ]);

    expect(result.manifestPath).toBe(join(out, 'screenshot-manifest.json'));
    let manifest = JSON.parse(readFileSync(result.manifestPath!, 'utf8'));
    expect(manifest.ok).toBe(true);
    expect(manifest.captures).toHaveLength(4);
    expect(manifest.captures[0]).toMatchObject({
      card: CARD_URL,
      name: 'wide',
      status: 'ok',
      sha256: PNG_SHA256,
    });
  });

  it('lists every requested capture name when a card-level request fails', async () => {
    let { authenticator } = makeFake({
      postResponses: [() => new Response('boom', { status: 500 })],
    });
    let out = tempDir();
    let specPath = join(out, 'captures.json');
    writeFileSync(
      specPath,
      JSON.stringify({
        card: CARD_URL,
        captureSpec: { captures: [{ name: 'a' }, { name: 'b' }] },
      }),
    );
    let result = await screenshot(undefined, { authenticator, out, specPath });
    expect(result.ok).toBe(false);
    expect(result.captures.map((c) => c.name)).toEqual(['a', 'b']);
    expect(result.captures.every((c) => c.status === 'error')).toBe(true);
  });

  it('rejects combining a card URL or capture flags with --spec', async () => {
    let out = tempDir();
    let specPath = join(out, 'captures.json');
    writeFileSync(specPath, JSON.stringify({ card: CARD_URL }));

    let both = await screenshot(CARD_URL, { specPath });
    expect(both.error).toContain('not both');

    let flags = await screenshot(undefined, {
      specPath,
      captureSpec: { fullPage: true },
    });
    expect(flags.error).toContain('spec file');
  });

  it('rejects a spec entry without a card URL', async () => {
    let out = tempDir();
    let specPath = join(out, 'captures.json');
    writeFileSync(specPath, JSON.stringify([{ format: 'isolated' }]));
    let result = await screenshot(undefined, { specPath });
    expect(result.error).toContain('"card"');
  });

  it('rejects a seed-mode spec whose cards span more than one realm owner', async () => {
    let out = tempDir();
    let specPath = join(out, 'captures.json');
    writeFileSync(
      specPath,
      JSON.stringify([
        { card: 'http://realms.example.test/owner-a/workspace/Person/1' },
        { card: 'http://realms.example.test/owner-b/workspace/Person/2' },
      ]),
    );
    let result = await screenshot(undefined, {
      specPath,
      realmSecretSeed: 'test-seed',
    });
    expect(result.error).toContain('one realm owner per invocation');

    // An explicit --as-user unifies the identity across owners on the same
    // server, so the guard only trips across server origins then.
    writeFileSync(
      specPath,
      JSON.stringify([
        { card: 'http://realms.example.test/owner-a/workspace/Person/1' },
        { card: 'http://elsewhere.example.test/owner-a/workspace/Person/2' },
      ]),
    );
    let crossOrigin = await screenshot(undefined, {
      specPath,
      realmSecretSeed: 'test-seed',
      asUser: '@owner-a:example.test',
    });
    expect(crossOrigin.error).toContain('one realm owner per invocation');
  });
});

describe('boxel screenshot: CLI flag parsing', () => {
  function parseFlags(extra: string[]): Record<string, unknown> {
    let captured: Record<string, unknown> | null = null;
    let program = new Command().exitOverride();
    registerScreenshotCommand(program);
    let cmd = program.commands.find((c) => c.name() === 'screenshot')!;
    cmd.action((_cardUrl: string | undefined, opts: object) => {
      captured = { ...opts };
    });
    program.parse(['screenshot', CARD_URL, ...extra], { from: 'user' });
    return captured!;
  }

  it('parses dimension, clip, and scale flags into structured values', () => {
    let opts = parseFlags([
      '--viewport',
      '800x600',
      '--envelope',
      '400x300',
      '--dsf',
      '2',
      '--clip',
      '0,0,200,150',
      '--target',
      '.avatar',
      '--full-page',
      '--max-wait',
      '30',
    ]);
    expect(opts.viewport).toEqual({ width: 800, height: 600 });
    expect(opts.envelope).toEqual({ width: 400, height: 300 });
    expect(opts.dsf).toBe(2);
    expect(opts.clip).toEqual({ x: 0, y: 0, width: 200, height: 150 });
    expect(opts.target).toBe('.avatar');
    expect(opts.fullPage).toBe(true);
    expect(opts.maxWait).toBe(30);
  });

  it('defaults format to isolated and max-wait to 120', () => {
    let opts = parseFlags([]);
    expect(opts.format).toBe('isolated');
    expect(opts.maxWait).toBe(120);
  });

  it('translates flags into a capture spec, eliding an empty one to null', () => {
    expect(captureSpecFromFlags({})).toBeNull();
    expect(
      captureSpecFromFlags({
        viewport: { width: 800, height: 600 },
        dsf: 2,
        target: '.foo',
        fullPage: true,
      }),
    ).toEqual({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 2,
      target: '.foo',
      fullPage: true,
    });
  });
});
