import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  computeEnvSlug,
  resolveBoxelEnvironment,
  resolveEnvironment,
} from '../../src/commands/profile.js';

const STAGING = {
  domain: 'stack.cards',
  matrixUrl: 'https://matrix-staging.stack.cards',
  realmServerUrl: 'https://realms-staging.stack.cards/',
  appUrl: undefined,
};
const PRODUCTION = {
  domain: 'boxel.ai',
  matrixUrl: 'https://matrix.boxel.ai',
  realmServerUrl: 'https://app.boxel.ai/',
  appUrl: undefined,
};
const LOCAL = {
  domain: 'localhost',
  matrixUrl: 'http://localhost:8008',
  realmServerUrl: 'https://localhost:4201/',
  appUrl: 'https://localhost:4200/',
};

describe('computeEnvSlug', () => {
  // Mirrors scripts/env-slug.sh. Each case covers a transformation the
  // shell pipeline performs, so a regression in the TS implementation
  // shows up immediately rather than waiting for an end-to-end run.
  it('lowercases input', () => {
    expect(computeEnvSlug('CS-10998-Foo')).toBe('cs-10998-foo');
  });

  it('converts "/" to "-"', () => {
    expect(computeEnvSlug('My/Branch')).toBe('my-branch');
  });

  it('strips characters outside [a-z0-9-]', () => {
    expect(computeEnvSlug('My/Branch_Name!')).toBe('my-branchname');
  });

  it('collapses runs of "-"', () => {
    expect(computeEnvSlug('foo--bar---baz')).toBe('foo-bar-baz');
  });

  it('trims leading and trailing "-"', () => {
    expect(computeEnvSlug('-foo-bar-')).toBe('foo-bar');
  });

  it('returns an empty string when no slug characters remain', () => {
    expect(computeEnvSlug('!!!')).toBe('');
  });
});

describe('resolveBoxelEnvironment', () => {
  const originalEnv = process.env.BOXEL_ENVIRONMENT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BOXEL_ENVIRONMENT;
    } else {
      process.env.BOXEL_ENVIRONMENT = originalEnv;
    }
  });

  it('returns null when BOXEL_ENVIRONMENT is unset', () => {
    delete process.env.BOXEL_ENVIRONMENT;
    expect(resolveBoxelEnvironment()).toBeNull();
  });

  it('returns null when BOXEL_ENVIRONMENT is empty / whitespace', () => {
    process.env.BOXEL_ENVIRONMENT = '   ';
    expect(resolveBoxelEnvironment()).toBeNull();
  });

  it('derives ".${slug}.localhost" URLs from a clean slug', () => {
    process.env.BOXEL_ENVIRONMENT = 'cs-10998-foo';
    expect(resolveBoxelEnvironment()).toEqual({
      domain: 'cs-10998-foo.localhost',
      matrixUrl: 'https://matrix.cs-10998-foo.localhost',
      realmServerUrl: 'https://realm-server.cs-10998-foo.localhost/',
    });
  });

  it('slugifies a messy value the same way env-slug.sh does', () => {
    process.env.BOXEL_ENVIRONMENT = 'My/Branch_Name!';
    expect(resolveBoxelEnvironment()).toEqual({
      domain: 'my-branchname.localhost',
      matrixUrl: 'https://matrix.my-branchname.localhost',
      realmServerUrl: 'https://realm-server.my-branchname.localhost/',
    });
  });
});

describe('resolveEnvironment', () => {
  const originalEnv = process.env.BOXEL_ENVIRONMENT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BOXEL_ENVIRONMENT;
    } else {
      process.env.BOXEL_ENVIRONMENT = originalEnv;
    }
    vi.restoreAllMocks();
  });

  // Nothing named an environment: `boxel profile add` with no flags at all.
  it('defaults to production', () => {
    delete process.env.BOXEL_ENVIRONMENT;
    expect(resolveEnvironment({})).toEqual({
      environment: PRODUCTION,
      source: 'default',
      overrides: {
        matrixUrl: undefined,
        realmServerUrl: undefined,
        appUrl: undefined,
      },
    });
  });

  it('resolves each preset flag', () => {
    delete process.env.BOXEL_ENVIRONMENT;
    expect(resolveEnvironment({ staging: true })).toMatchObject({
      environment: STAGING,
      source: 'flag',
    });
    expect(resolveEnvironment({ local: true })).toMatchObject({
      environment: LOCAL,
      source: 'flag',
    });
    // --production is a no-op alias, there so a script can be explicit — but
    // it still counts as having named an environment.
    expect(resolveEnvironment({ production: true })).toMatchObject({
      environment: PRODUCTION,
      source: 'flag',
    });
  });

  it('errors when more than one preset flag is passed', () => {
    delete process.env.BOXEL_ENVIRONMENT;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    expect(() => resolveEnvironment({ staging: true, local: true })).toThrow(
      'process.exit(1)',
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.join('\n')).toMatch(
      /at most one of --production, --staging, --local \(got --staging, --local\)/,
    );
  });

  it('lets URL flags override the chosen environment field by field', () => {
    expect(
      resolveEnvironment({
        staging: true,
        matrixUrl: 'https://matrix.my.server',
        hostUrl: 'https://app.my.server/',
      }),
    ).toEqual({
      environment: {
        // Still staging's: --staging said which environment this is, so only
        // the fields that were overridden change.
        domain: 'stack.cards',
        matrixUrl: 'https://matrix.my.server',
        realmServerUrl: 'https://realms-staging.stack.cards/',
        appUrl: 'https://app.my.server/',
      },
      source: 'flag',
      overrides: {
        matrixUrl: 'https://matrix.my.server',
        realmServerUrl: undefined,
        appUrl: 'https://app.my.server/',
      },
    });
  });

  it('takes the Matrix ID domain from --matrix-url when nothing else names an environment', () => {
    delete process.env.BOXEL_ENVIRONMENT;
    // The interactive terminal path builds "@<username>:<domain>", so with a
    // custom homeserver the domain has to come from the homeserver's own URL
    // rather than from production's boxel.ai. A leading "matrix"-ish label is
    // dropped, the way matrix.boxel.ai serves boxel.ai.
    expect(
      resolveEnvironment({
        matrixUrl: 'https://matrix.my.server',
        realmServerUrl: 'https://realms.my.server/',
      }).environment,
    ).toMatchObject({
      domain: 'my.server',
      matrixUrl: 'https://matrix.my.server',
      realmServerUrl: 'https://realms.my.server/',
    });
    expect(
      resolveEnvironment({ matrixUrl: 'https://synapse.my.server' }).environment
        .domain,
    ).toBe('synapse.my.server');
  });

  it('prefers a preset flag over BOXEL_ENVIRONMENT', () => {
    process.env.BOXEL_ENVIRONMENT = 'cs-10998-foo';
    expect(resolveEnvironment({ staging: true })).toMatchObject({
      environment: STAGING,
      source: 'flag',
    });
  });

  it('prefers a recognized -u domain over BOXEL_ENVIRONMENT', () => {
    // BOXEL_ENVIRONMENT is exported by the mise tasks, so it lingers in a
    // shell. Letting it win here would write a profile whose Matrix ID says
    // boxel.ai while its URLs point at matrix.cs-10998-foo.localhost.
    process.env.BOXEL_ENVIRONMENT = 'cs-10998-foo';
    expect(resolveEnvironment({ user: '@alice:boxel.ai' })).toMatchObject({
      environment: PRODUCTION,
      source: 'matrix-id',
    });
  });

  it('resolves each recognized -u domain', () => {
    delete process.env.BOXEL_ENVIRONMENT;
    expect(
      resolveEnvironment({ user: '@alice:stack.cards' }).environment,
    ).toEqual(STAGING);
    expect(resolveEnvironment({ user: '@alice:boxel.ai' }).environment).toEqual(
      PRODUCTION,
    );
    expect(
      resolveEnvironment({ user: '@alice:localhost' }).environment,
    ).toEqual(LOCAL);
  });

  it('prefers BOXEL_ENVIRONMENT over the production default', () => {
    process.env.BOXEL_ENVIRONMENT = 'cs-10998-foo';
    expect(
      resolveEnvironment({ user: '@alice:cs-10998-foo.localhost' }),
    ).toMatchObject({
      environment: {
        domain: 'cs-10998-foo.localhost',
        matrixUrl: 'https://matrix.cs-10998-foo.localhost',
        realmServerUrl: 'https://realm-server.cs-10998-foo.localhost/',
      },
      source: 'boxel-environment',
    });
  });

  it('reports source "default" for an unrecognized -u domain, keeping only the URL flags', () => {
    delete process.env.BOXEL_ENVIRONMENT;
    // `profile add` passes `overrides` rather than `environment` in this case,
    // so an unrecognized domain gets ProfileManager's "provide explicit
    // --matrix-url and --realm-server-url" error instead of a production login
    // attempt for an account that doesn't live there.
    const resolved = resolveEnvironment({ user: '@alice:my.server' });
    expect(resolved.source).toBe('default');
    expect(resolved.overrides).toEqual({
      matrixUrl: undefined,
      realmServerUrl: undefined,
      appUrl: undefined,
    });
  });

  it('never reads BOXEL_ENVIRONMENT once -u and both URL flags are supplied', () => {
    // A value that slugifies to empty exits 1 when read. A fully-specified
    // invocation leaves it nothing to fill in, so it must not be read at all.
    process.env.BOXEL_ENVIRONMENT = '!!!';
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    expect(
      resolveEnvironment({
        user: '@alice:my.server',
        matrixUrl: 'https://matrix.my.server',
        realmServerUrl: 'https://realms.my.server/',
      }).source,
    ).toBe('default');
    expect(exit).not.toHaveBeenCalled();
  });
});
