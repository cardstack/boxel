import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import jwt from 'jsonwebtoken';

import {
  buildRenderURL,
  mintRenderToken,
  writeRenderFile,
  type DiagnosticRenderSession,
} from '../../src/commands/realm-server/render-token.js';

const SEED = 'a realm secret seed for tests';
const CARD = 'https://realms.example.test/owner/realm/Person/1';

function minted(
  overrides: Partial<DiagnosticRenderSession> = {},
): DiagnosticRenderSession {
  return {
    id: '7f1d2c3b-0000-4000-8000-000000000001',
    card: CARD,
    realm: 'https://realms.example.test/owner/realm/',
    user: '@owner:example.test',
    realms: ['https://realms.example.test/owner/realm/'],
    hostURL: 'https://host.example.test/',
    mintedAt: '2026-10-16T12:00:00.000Z',
    expiresAt: '2026-10-16T12:15:00.000Z',
    session: JSON.stringify({
      'https://realms.example.test/owner/realm/': 'a.session.jwt',
    }),
    ...overrides,
  };
}

function fakeServer(answer: { status?: number; body: unknown }) {
  let requests: {
    method: string;
    url: string;
    authorization: string;
    body: string | undefined;
  }[] = [];
  let fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    let headers = new Headers(init?.headers);
    requests.push({
      method: init?.method ?? 'GET',
      url: String(input),
      authorization: headers.get('Authorization') ?? '',
      body: init?.body as string | undefined,
    });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const options = (fetch: typeof globalThis.fetch) => ({
  realmServerUrl: 'https://realms.example.test',
  realmSecretSeed: SEED,
  fetch,
});

describe('boxel realm-server render-token', () => {
  it('builds the render route URL the prerenderer visits', () => {
    expect(buildRenderURL('https://host.example.test', CARD)).toBe(
      `https://host.example.test/render/${encodeURIComponent(`${CARD}.json`)}/1/${encodeURIComponent('{"cardRender":true}')}/html/isolated/0`,
    );
    expect(
      buildRenderURL('https://host.example.test/', `${CARD}.json`, {
        format: 'fitted',
        clearCache: true,
      }),
    ).toBe(
      `https://host.example.test/render/${encodeURIComponent(`${CARD}.json`)}/1/${encodeURIComponent('{"cardRender":true,"clearCache":true}')}/html/fitted/0`,
    );
  });

  it('asks the server with a diagnostic-render operator token bound to its origin', async () => {
    let server = fakeServer({ body: minted() });
    let render = await mintRenderToken(options(server.fetch), {
      card: CARD,
      note: 'an engineer, profiling a slow render',
      realmOnly: true,
    });
    expect(server.requests).toHaveLength(1);
    let [sent] = server.requests;
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(
      'https://realms.example.test/_diagnostic-render-token',
    );
    expect(JSON.parse(sent.body!)).toEqual({
      card: CARD,
      note: 'an engineer, profiling a slow render',
      realmOnly: true,
    });
    let claims = jwt.verify(sent.authorization.replace('Bearer ', ''), SEED, {
      audience: 'https://realms.example.test',
    }) as Record<string, unknown>;
    expect(claims.operator).toBe('diagnostic-render');
    expect(render.renderURL).toBe(
      buildRenderURL('https://host.example.test/', CARD),
    );
    expect(render.session).toBe(minted().session);
  });

  it("reports the server's refusal", async () => {
    let server = fakeServer({
      status: 404,
      body: { errors: ['no realm on this server holds the card'] },
    });
    await expect(
      mintRenderToken(options(server.fetch), { card: CARD, note: 'me' }),
    ).rejects.toThrow(/HTTP 404: no realm on this server holds the card/);
  });

  it('refuses an empty note and an unknown format before asking', async () => {
    let server = fakeServer({ body: minted() });
    await expect(
      mintRenderToken(options(server.fetch), { card: CARD, note: '  ' }),
    ).rejects.toThrow(/note is empty/);
    await expect(
      mintRenderToken(options(server.fetch), {
        card: CARD,
        note: 'me',
        format: 'thumbnail',
      }),
    ).rejects.toThrow(/--format/);
    expect(server.requests).toHaveLength(0);
  });

  it('writes the file readable by its owner alone', () => {
    let path = join(mkdtempSync(join(tmpdir(), 'render-token-')), 'out.json');
    let render = { ...minted(), renderURL: 'https://host.example.test/r' };
    writeRenderFile(path, render);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(render);
  });

  it('refuses to write through a symlink planted at the path', () => {
    let dir = mkdtempSync(join(tmpdir(), 'render-token-'));
    let target = join(dir, 'planted.json');
    writeFileSync(target, 'untouched');
    let path = join(dir, 'out.json');
    symlinkSync(target, path);
    expect(() =>
      writeRenderFile(path, { ...minted(), renderURL: 'https://h.test/r' }),
    ).toThrow(/ELOOP/);
    expect(readFileSync(target, 'utf8')).toBe('untouched');
  });
});
