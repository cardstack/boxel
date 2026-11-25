import { describe, it, expect } from 'vitest';
import { isRealmServerEndpoint } from '../../src/lib/realm-client.ts';

const SERVER = 'https://app.example.test/';

describe('isRealmServerEndpoint', () => {
  it('matches an underscore endpoint directly under the server root', () => {
    expect(isRealmServerEndpoint(`${SERVER}_publish-realm`, SERVER)).toBe(true);
    expect(isRealmServerEndpoint(`${SERVER}_host-urls`, SERVER)).toBe(true);
    expect(isRealmServerEndpoint(`${SERVER}_host-urls/`, SERVER)).toBe(true);
  });

  it('matches an endpoint with a query string', () => {
    expect(
      isRealmServerEndpoint(
        `${SERVER}_host-urls?realm=${encodeURIComponent(`${SERVER}mango/test/`)}`,
        SERVER,
      ),
    ).toBe(true);
  });

  it('matches a resource under an endpoint', () => {
    expect(
      isRealmServerEndpoint(
        `${SERVER}_host-urls/0b6c1f2e-8a51-4f6b-9a3e-2c4d5e6f7a8b`,
        SERVER,
      ),
    ).toBe(true);
    expect(
      isRealmServerEndpoint(
        `${SERVER}_host-urls/home-page-check?realm=x`,
        SERVER,
      ),
    ).toBe(true);
    expect(
      isRealmServerEndpoint(`${SERVER}_boxel-claimed-domains/123`, SERVER),
    ).toBe(true);
  });

  it('does not match a per-realm endpoint', () => {
    expect(
      isRealmServerEndpoint(`${SERVER}mango/test/_readiness-check`, SERVER),
    ).toBe(false);
    expect(
      isRealmServerEndpoint(`${SERVER}mango/test/_publishability`, SERVER),
    ).toBe(false);
  });

  it('does not match a realm URL or the server root', () => {
    expect(isRealmServerEndpoint(`${SERVER}mango/test/`, SERVER)).toBe(false);
    expect(isRealmServerEndpoint(SERVER, SERVER)).toBe(false);
  });

  it('does not match a URL on another origin', () => {
    expect(
      isRealmServerEndpoint('https://other.example.test/_host-urls', SERVER),
    ).toBe(false);
  });
});
