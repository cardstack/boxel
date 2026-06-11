import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  describeViolations,
  publishCliOptsToOptions,
  registerPublishCommand,
} from '../../src/commands/realm/publish.ts';
import type { PublishabilityViolation } from '@cardstack/runtime-common/publishability';

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

  it('--force sets opts.force; otherwise it is undefined (gate on by default)', () => {
    expect(parsePublishFlags([]).capturedOpts!.force).toBeUndefined();
    expect(parsePublishFlags(['--force']).capturedOpts!.force).toBe(true);
  });

  it('--json sets opts.json', () => {
    expect(parsePublishFlags([]).capturedOpts!.json).toBeUndefined();
    expect(parsePublishFlags(['--json']).capturedOpts!.json).toBe(true);
  });
});

describe('publishCliOptsToOptions translation', () => {
  it('translates empty opts to defaults that preserve current behavior', () => {
    expect(publishCliOptsToOptions({})).toEqual({
      waitForReady: true,
      timeoutMs: undefined,
      republish: true,
      force: false,
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

  it('translates --force to force: true (default false keeps the gate on)', () => {
    expect(publishCliOptsToOptions({}).force).toBe(false);
    expect(publishCliOptsToOptions({ force: true }).force).toBe(true);
  });
});

describe('describeViolations (publishability gate message)', () => {
  it('summarizes private-dependency and error-document violations and names resources', () => {
    let violations: PublishabilityViolation[] = [
      {
        kind: 'private-dependency',
        resource: 'https://realm/test/a',
        externalDependencies: [],
      },
      {
        kind: 'error-document',
        resource: 'https://realm/test/b',
      },
    ];
    let message = describeViolations(violations);
    expect(message).toContain('1 private-dependency violation(s)');
    expect(message).toContain('1 error-document violation(s)');
    expect(message).toContain('--force');
    expect(message).toContain('https://realm/test/a');
    expect(message).toContain('https://realm/test/b');
  });

  it('caps the listed resources at five', () => {
    let violations: PublishabilityViolation[] = Array.from(
      { length: 7 },
      (_unused, i) => ({
        kind: 'error-document' as const,
        resource: `https://realm/test/${i}`,
      }),
    );
    let message = describeViolations(violations);
    expect(message).toContain('7 error-document violation(s)');
    expect(message).toContain('https://realm/test/4');
    expect(message).not.toContain('https://realm/test/5');
  });
});
