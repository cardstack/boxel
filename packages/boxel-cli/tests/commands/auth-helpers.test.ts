import { describe, it, expect } from 'vitest';
import { isTokenExpiring } from '../../src/lib/auth.js';

function encodeJwt(payload: object): string {
  let header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  let body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // signature is irrelevant for expiry checks
  return `${header}.${body}.sig`;
}

describe('isTokenExpiring', () => {
  it('treats missing tokens as expiring', () => {
    expect(isTokenExpiring(undefined)).toBe(true);
    expect(isTokenExpiring('')).toBe(true);
  });

  it('treats malformed tokens as expiring', () => {
    expect(isTokenExpiring('not-a-jwt')).toBe(true);
    expect(isTokenExpiring('too.short')).toBe(true);
  });

  it('returns true when the token expires within the lead time', () => {
    let nowSec = Math.floor(Date.now() / 1000);
    let jwt = encodeJwt({ exp: nowSec + 30 });
    expect(isTokenExpiring(jwt, 60)).toBe(true);
  });

  it('returns false when the token has plenty of lifetime left', () => {
    let nowSec = Math.floor(Date.now() / 1000);
    let jwt = encodeJwt({ exp: nowSec + 3600 });
    expect(isTokenExpiring(jwt, 60)).toBe(false);
  });

  it('strips a "Bearer" scheme prefix before decoding', () => {
    let nowSec = Math.floor(Date.now() / 1000);
    let jwt = encodeJwt({ exp: nowSec + 3600 });
    expect(isTokenExpiring(`Bearer ${jwt}`)).toBe(false);
  });

  it('treats tokens without an exp claim as non-expiring', () => {
    let jwt = encodeJwt({ sub: 'abc' });
    expect(isTokenExpiring(jwt)).toBe(false);
  });
});
