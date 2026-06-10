import { describe, expect, it } from 'vitest';
import { describeFetchError } from '../../src/lib/describe-fetch-error.ts';

describe('describeFetchError', () => {
  it('returns the message for a plain Error without a cause', () => {
    let err = new Error('boom');
    expect(describeFetchError(err)).toBe('boom');
  });

  it('returns the string form for a non-Error value', () => {
    expect(describeFetchError('plain string')).toBe('plain string');
    expect(describeFetchError(42)).toBe('42');
    expect(describeFetchError(null)).toBe('null');
    expect(describeFetchError(undefined)).toBe('undefined');
  });

  it('appends an Error cause with a (caused by: …) suffix', () => {
    // Build via assignment to sidestep the ErrorOptions TS lib target.
    let socketErr = new Error('ECONNRESET: socket hang up');
    let fetchErr = new TypeError('fetch failed') as TypeError & {
      cause?: unknown;
    };
    fetchErr.cause = socketErr;
    expect(describeFetchError(fetchErr)).toBe(
      'fetch failed (caused by: ECONNRESET: socket hang up)',
    );
  });

  it('renders a non-Error cause via String()', () => {
    let err = new Error('outer') as Error & { cause?: unknown };
    err.cause = { code: 'ENOTFOUND' };
    expect(describeFetchError(err)).toBe('outer (caused by: [object Object])');
  });

  it('preserves falsy-but-defined causes that a truthy check would drop', () => {
    // The behavior this guards is the difference between `error.cause`
    // (truthy check, drops falsy values) and `error.cause != null`
    // (preserves any explicit value). Verifies the four falsy
    // primitives a Promise.reject could plausibly carry.
    for (let cause of ['', 0, false, NaN]) {
      let err = new Error('outer') as Error & { cause?: unknown };
      err.cause = cause;
      expect(describeFetchError(err)).toBe(
        `outer (caused by: ${String(cause)})`,
      );
    }
  });

  it('omits the (caused by: …) suffix for null or undefined causes', () => {
    for (let cause of [null, undefined]) {
      let err = new Error('outer') as Error & { cause?: unknown };
      err.cause = cause;
      expect(describeFetchError(err)).toBe('outer');
    }
  });
});
