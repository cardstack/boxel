import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  registerReadCommand,
  resolveReadTarget,
} from '../../src/commands/file/read.ts';

describe('resolveReadTarget', () => {
  it('derives realm and path from a full @cardstack/ identifier', () => {
    expect(
      resolveReadTarget('@cardstack/catalog/nested/card.gts', undefined),
    ).toEqual({
      ok: true,
      realm: '@cardstack/catalog/',
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
    );
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.error).toContain('not both');
    }
  });

  it('rejects a relative path without --realm', () => {
    let target = resolveReadTarget('hello.json', undefined);
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.error).toContain('--realm is required');
    }
  });

  it('rejects a bare realm identifier with no file path', () => {
    // No path component after the realm, so it isn't a full file
    // identifier — and there's no --realm to pair it with.
    let target = resolveReadTarget('@cardstack/catalog/', undefined);
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
