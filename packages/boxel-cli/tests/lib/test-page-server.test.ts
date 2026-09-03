import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startTestPageServer } from '../../src/lib/test-engine.ts';

// A copy of what `CachingDefinitionLookup.probeRemoteRealm` accepts as "yes"
// when it reads `x-boxel-realm-public-readable`. Its accept-list is private,
// so this restates it rather than sharing it; keep the two in step.
const TRUTHY_PUBLIC_READABLE = ['true', '1', 'yes'];

describe('local-mode test page server realm mounts', () => {
  let tempDirs: string[] = [];
  let server: Server | undefined;
  let baseUrl: string;
  let realmURL: (prefix: string) => string;

  function tempDir(): string {
    let dir = mkdtempSync(join(tmpdir(), 'boxel-test-page-server-'));
    tempDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    // `hostDistDir` backs only the fall-through static branch, so an empty
    // directory is enough to exercise the mounts.
    let hostDistDir = tempDir();
    let workspaceDir = tempDir();
    let baseDir = tempDir();

    writeFileSync(
      join(workspaceDir, 'sample.gts'),
      'export const nickname = "sample";\n',
    );
    writeFileSync(
      join(baseDir, 'card-api.gts'),
      'export class CardInfoField {}\n',
    );
    writeFileSync(join(baseDir, 'realm-info.json'), '{"name":"base"}\n');

    let started = await startTestPageServer({
      hostDistDir,
      realmMounts: [
        { prefix: 'workspace', root: workspaceDir },
        { prefix: 'base', root: baseDir },
      ],
    });
    server = started.server;
    baseUrl = started.url;
    realmURL = started.realmURL;
  });

  afterEach(async () => {
    if (server) {
      let closing = server;
      // `fetch` leaves keep-alive sockets behind, and `close` waits on them.
      closing.closeAllConnections?.();
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
    server = undefined;
    for (let dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  // A mount serves a realm's modules without being a realm, so these headers
  // are the only thing that can name the owner of a module served from one.
  // `CachingDefinitionLookup.buildLookupContext` resolves an owner for any
  // module outside its registered realms by HEADing the module URL and reading
  // them; with no owner to name, `lookupDefinition` throws
  // `FilterRefersToNonexistentTypeError` and fails the field-tree walk behind
  // every card GET — `CardDef.cardInfo` holds a `CardInfoField` served from
  // the base mount, so that walk reaches a mounted module for every card.
  it('answers the owning-realm probe on a HEAD of a mounted module', async () => {
    let response = await fetch(`${baseUrl}/base/card-api`, { method: 'HEAD' });

    expect(response.ok).toBe(true);
    expect(response.headers.get('x-boxel-realm-url')).toBe(realmURL('base'));
    expect(TRUTHY_PUBLIC_READABLE).toContain(
      response.headers.get('x-boxel-realm-public-readable')?.toLowerCase(),
    );
  });

  it('names the mount that served the module, not one shared realm', async () => {
    let fromWorkspace = await fetch(`${baseUrl}/workspace/sample`);
    let fromBase = await fetch(`${baseUrl}/base/realm-info.json`);

    expect(realmURL('workspace')).not.toBe(realmURL('base'));
    expect(fromWorkspace.headers.get('x-boxel-realm-url')).toBe(
      realmURL('workspace'),
    );
    expect(fromBase.headers.get('x-boxel-realm-url')).toBe(realmURL('base'));
  });

  // The mounts are reached same-origin in local mode, so nothing here depends
  // on the exposure list today. It names what the identity headers are worth
  // to a reader that is not same-origin, alongside the blanket allow-origin
  // these responses already carry.
  it('names the realm headers in its exposure list', async () => {
    let response = await fetch(`${baseUrl}/workspace/sample`);

    let exposed = (response.headers.get('access-control-expose-headers') ?? '')
      .split(',')
      .map((header) => header.trim().toLowerCase());
    expect(exposed).toContain('x-boxel-realm-url');
    expect(exposed).toContain('x-boxel-realm-public-readable');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('carries the realm headers on a missing module', async () => {
    let response = await fetch(`${baseUrl}/base/does-not-exist`);

    expect(response.status).toBe(404);
    expect(response.headers.get('x-boxel-realm-url')).toBe(realmURL('base'));
  });

  // `buildModuleModel` HEADs a module with `Accept: card-source` and treats
  // only a 404 as shimmed, so for a module the mount actually serves it reads
  // `last-modified` and fails the render without one — which the definition
  // lookup persists as a module error, throwing the same
  // `FilterRefersToNonexistentTypeError` an unidentified mount throws.
  it('dates a mounted module so its prerender can model it', async () => {
    let head = await fetch(`${baseUrl}/base/card-api`, { method: 'HEAD' });
    let raw = await fetch(`${baseUrl}/base/realm-info.json`);

    for (let response of [head, raw]) {
      let lastModified = response.headers.get('last-modified');
      expect(lastModified).toBeTruthy();
      // The host parses this as RFC 7231 IMF-fixdate.
      expect(lastModified).toMatch(
        /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
      );
      expect(Number.isNaN(Date.parse(lastModified!))).toBe(false);
    }
  });

  // The realm URL a mount reports has to be the one the browser is handed for
  // that prefix, which local mode derives from this same server's origin (the
  // test page, the mounts and the host config all share it). A mount naming
  // any other host, port or shape would resolve to a realm the definition
  // cache and the loader's realm mapping never agree on.
  it('reports a realm URL derived from the origin serving the page', async () => {
    let response = await fetch(`${baseUrl}/base/card-api`, { method: 'HEAD' });

    let expected = new URL('/base/', baseUrl).href;
    expect(realmURL('base')).toBe(expected);
    expect(response.headers.get('x-boxel-realm-url')).toBe(expected);
  });

  it('still transpiles a mounted .gts module', async () => {
    let response = await fetch(`${baseUrl}/workspace/sample`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/javascript');
    expect(response.headers.get('x-boxel-cli-transpiled')).toBe('1');
    expect(await response.text()).toContain('nickname');
  });

  it('identifies the realm on the _mtimes discovery document', async () => {
    let response = await fetch(`${baseUrl}/workspace/_mtimes`, {
      headers: { Accept: 'application/vnd.api+json' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-boxel-realm-url')).toBe(
      realmURL('workspace'),
    );
    let { data } = (await response.json()) as {
      data: { id: string; attributes: { mtimes: Record<string, number> } };
    };
    expect(data.id).toBe(realmURL('workspace'));
    expect(Object.keys(data.attributes.mtimes)).toContain(
      `${realmURL('workspace')}sample.gts`,
    );
  });
});
