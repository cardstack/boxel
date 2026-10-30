import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { PrefixRealmNetwork } from '@cardstack/runtime-common/prefix-realm-network';
import {
  registerReadCommand,
  resolveReadTarget,
} from '../../src/commands/file/read.ts';

// The realm server's network, as `file read` builds it from the served prefix
// map. The catalog is served away from `<server>/catalog/` so a target that
// guessed from the prefix's spelling would come out wrong.
const network = new PrefixRealmNetwork({
  '@cardstack/catalog/': 'https://catalog.example.test/',
});

describe('resolveReadTarget', () => {
  it('derives realm and path from a full @cardstack/ identifier through the network', () => {
    expect(
      resolveReadTarget(
        '@cardstack/catalog/nested/card.gts',
        undefined,
        network,
      ),
    ).toEqual({
      ok: true,
      realm: 'https://catalog.example.test/',
      path: 'nested/card.gts',
    });
  });

  it('passes --realm and a relative path through unchanged', () => {
    expect(
      resolveReadTarget('hello.json', 'http://localhost:4201/user/realm/'),
    ).toEqual({
      ok: true,
      realm: 'http://localhost:4201/user/realm/',
      path: 'hello.json',
    });
  });

  it('accepts an @cardstack/ identifier as --realm with a relative path', () => {
    expect(resolveReadTarget('hello.json', '@cardstack/catalog/')).toEqual({
      ok: true,
      realm: '@cardstack/catalog/',
      path: 'hello.json',
    });
  });

  it('rejects a full identifier combined with --realm', () => {
    let target = resolveReadTarget(
      '@cardstack/catalog/hello.json',
      'http://localhost:4201/catalog/',
      network,
    );
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.error).toContain('not both');
    }
  });

  it('rejects a relative path without --realm', () => {
    let target = resolveReadTarget('hello.json', undefined, network);
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.error).toContain('--realm is required');
    }
  });

  it('rejects a bare realm identifier with no file path', () => {
    let target = resolveReadTarget('@cardstack/catalog/', undefined, network);
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.error).toContain('names a realm, not a file');
    }
  });

  it('rejects a prefix the network does not know as it would a relative path', () => {
    let target = resolveReadTarget(
      '@other/realm/hello.json',
      undefined,
      network,
    );
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.error).toContain('--realm is required');
    }
  });
});

describe('boxel file read CLI parsing', () => {
  function parseRead(args: string[]): {
    capturedPath: string | null;
    capturedOpts: Record<string, unknown> | null;
  } {
    let capturedPath: string | null = null;
    let capturedOpts: Record<string, unknown> | null = null;

    const program = new Command().exitOverride();
    const file = program.command('file');
    registerReadCommand(file);
    const readCmd = file.commands.find((c) => c.name() === 'read');
    if (!readCmd) {
      throw new Error('read subcommand not registered');
    }

    // Replace the action so we capture parsed inputs without executing
    // read() (which would need a real realm-server).
    readCmd.action((filePath: string, opts: object) => {
      capturedPath = filePath;
      capturedOpts = { ...opts } as Record<string, unknown>;
    });

    program.parse(['file', 'read', ...args], { from: 'user' });
    return { capturedPath, capturedOpts };
  }

  it('parses a full @cardstack/ identifier without --realm', () => {
    // --realm was previously a requiredOption; commander must not reject
    // its absence now that a full identifier can carry the realm.
    let { capturedPath, capturedOpts } = parseRead([
      '@cardstack/catalog/hello.gts',
    ]);
    expect(capturedPath).toBe('@cardstack/catalog/hello.gts');
    expect(capturedOpts!.realm).toBeUndefined();
  });

  it('parses --realm alongside a relative path', () => {
    let { capturedPath, capturedOpts } = parseRead([
      'hello.gts',
      '--realm',
      '@cardstack/catalog/',
    ]);
    expect(capturedPath).toBe('hello.gts');
    expect(capturedOpts!.realm).toBe('@cardstack/catalog/');
  });
});
