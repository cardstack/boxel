import { describe, it, expect, afterEach } from 'vitest';
import {
  computeEnvSlug,
  resolveBoxelEnvironment,
} from '../../src/commands/profile.js';

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
