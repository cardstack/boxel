import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  publishCliOptsToOptions,
  registerPublishCommand,
} from '../../src/commands/realm/publish.ts';

// Regression test for the negated-flag bug fixed in CS-11161. Commander
// exposes `--no-foo` options on the positive key (`foo`) defaulting to
// `true`, so the CLI shim must read `opts.wait` / `opts.republish` — not
// `opts.noWait` / `opts.noRepublish`. The integration tests exercise the
// programmatic `publishRealm(...)` API only and missed this entirely.

function parsePublishFlags(extra: string[]): {
  capturedOpts: Record<string, unknown> | null;
  capturedArgs: [string, string] | null;
} {
  let capturedOpts: Record<string, unknown> | null = null;
  let capturedArgs: [string, string] | null = null;

  const program = new Command().exitOverride();
  const realm = program.command('realm');
  registerPublishCommand(realm);
  const publishCmd = realm.commands.find((c) => c.name() === 'publish');
  if (!publishCmd) {
    throw new Error('publish subcommand not registered');
  }

  // Replace the action so we capture the parsed opts without executing
  // publishRealm() (which would need a real realm-server).
  publishCmd.action((sourceUrl: string, publishedUrl: string, opts: object) => {
    capturedOpts = { ...opts } as Record<string, unknown>;
    capturedArgs = [sourceUrl, publishedUrl];
  });

  program.parse(
    [
      'realm',
      'publish',
      'http://src.localhost/',
      'http://pub.localhost/',
      ...extra,
    ],
    { from: 'user' },
  );

  return { capturedOpts, capturedArgs };
}

describe('boxel realm publish CLI flags', () => {
  it('with no flags, opts.wait and opts.republish default to true', () => {
    const { capturedOpts, capturedArgs } = parsePublishFlags([]);
    expect(capturedOpts).not.toBeNull();
    expect(capturedOpts!.wait).toBe(true);
    expect(capturedOpts!.republish).toBe(true);
    expect(capturedArgs).toEqual([
      'http://src.localhost/',
      'http://pub.localhost/',
    ]);
  });

  it('--no-wait flips opts.wait to false (not opts.noWait)', () => {
    const { capturedOpts } = parsePublishFlags(['--no-wait']);
    expect(capturedOpts!.wait).toBe(false);
    expect(capturedOpts!.republish).toBe(true);
    // Commander does not synthesize a noWait key — guarding against
    // a future regression where someone reintroduces opts.noWait.
    expect('noWait' in capturedOpts!).toBe(false);
  });

  it('--no-republish flips opts.republish to false (not opts.noRepublish)', () => {
    const { capturedOpts } = parsePublishFlags(['--no-republish']);
    expect(capturedOpts!.republish).toBe(false);
    expect(capturedOpts!.wait).toBe(true);
    expect('noRepublish' in capturedOpts!).toBe(false);
  });

  it('--timeout parses to opts.timeout as a number', () => {
    const { capturedOpts } = parsePublishFlags(['--timeout', '60000']);
    expect(capturedOpts!.timeout).toBe(60000);
  });
});

describe('publishCliOptsToOptions translation', () => {
  it('translates empty opts to defaults that preserve current behavior', () => {
    expect(publishCliOptsToOptions({})).toEqual({
      waitForReady: true,
      timeoutMs: undefined,
      republish: true,
    });
  });

  it('translates --no-wait to waitForReady: false', () => {
    expect(publishCliOptsToOptions({ wait: false }).waitForReady).toBe(false);
  });

  it('translates --no-republish to republish: false', () => {
    expect(publishCliOptsToOptions({ republish: false }).republish).toBe(false);
  });

  it('propagates --timeout into timeoutMs', () => {
    expect(publishCliOptsToOptions({ timeout: 12345 }).timeoutMs).toBe(12345);
  });
});
