import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startTestPageServer } from '../../src/lib/test-engine.ts';

// What `CachingDefinitionLookup.probeRemoteRealm` accepts as "yes" when it
// reads `x-boxel-realm-public-readable`.
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

  afterEach(() => {
    server?.close();
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

  it('exposes the realm headers to a cross-origin reader', async () => {
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
