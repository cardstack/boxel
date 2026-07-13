import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isRealmResourceIdentifier,
  resolveRealmIdentifier,
  splitRealmResourceIdentifier,
} from '../../src/lib/resolve-realm-identifier.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';

function emptyProfileManager(): {
  profileManager: ProfileManager;
  cleanup: () => void;
} {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-rri-test-'));
  return {
    profileManager: new ProfileManager(dir),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe('isRealmResourceIdentifier', () => {
  it('is true for @-prefixed identifiers and false for URLs', () => {
    expect(isRealmResourceIdentifier('@cardstack/catalog/')).toBe(true);
    expect(isRealmResourceIdentifier('http://localhost:4201/catalog/')).toBe(
      false,
    );
    expect(isRealmResourceIdentifier('catalog/')).toBe(false);
  });
});

describe('resolveRealmIdentifier', () => {
  const server = 'https://realms.example.test/';

  it('passes plain URLs through unchanged', () => {
    let result = resolveRealmIdentifier('http://localhost:4201/user/realm/', {
      realmServerUrl: server,
    });
    expect(result).toEqual({
      ok: true,
      url: 'http://localhost:4201/user/realm/',
    });
  });

  it('resolves @cardstack/catalog/ against the realm-server URL', () => {
    let result = resolveRealmIdentifier('@cardstack/catalog/', {
      realmServerUrl: server,
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://realms.example.test/catalog/',
    });
  });

  it('resolves @cardstack/base/ against the realm-server URL', () => {
    let result = resolveRealmIdentifier('@cardstack/base/', {
      realmServerUrl: server,
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://realms.example.test/base/',
    });
  });

  it('resolves a full file identifier, preserving the path', () => {
    let result = resolveRealmIdentifier('@cardstack/catalog/nested/card.gts', {
      realmServerUrl: server,
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://realms.example.test/catalog/nested/card.gts',
    });
  });

  it('tolerates a realm-server URL without a trailing slash', () => {
    let result = resolveRealmIdentifier('@cardstack/skills/', {
      realmServerUrl: 'https://realms.example.test',
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://realms.example.test/skills/',
    });
  });

  it('rejects non-cardstack scopes', () => {
    let result = resolveRealmIdentifier('@other/realm/', {
      realmServerUrl: server,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('only @cardstack/<realm>/');
    }
  });

  it('rejects a scope with no realm name', () => {
    let result = resolveRealmIdentifier('@cardstack/', {
      realmServerUrl: server,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Malformed realm identifier');
    }
  });

  describe('realm-server URL sources', () => {
    let savedEnv = process.env.REALM_SERVER_URL;
    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env.REALM_SERVER_URL;
      } else {
        process.env.REALM_SERVER_URL = savedEnv;
      }
    });

    it('falls back to REALM_SERVER_URL when there is no active profile', () => {
      process.env.REALM_SERVER_URL = 'https://env.example.test/';
      let { profileManager, cleanup } = emptyProfileManager();
      let result = resolveRealmIdentifier('@cardstack/catalog/', {
        profileManager,
      });
      cleanup();
      expect(result).toEqual({
        ok: true,
        url: 'https://env.example.test/catalog/',
      });
    });

    it('errors when no realm-server URL source is available', () => {
      delete process.env.REALM_SERVER_URL;
      let { profileManager, cleanup } = emptyProfileManager();
      let result = resolveRealmIdentifier('@cardstack/catalog/', {
        profileManager,
      });
      cleanup();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('boxel profile add');
      }
    });
  });
});

describe('splitRealmResourceIdentifier', () => {
  it('splits a full file identifier into realm and path', () => {
    expect(
      splitRealmResourceIdentifier('@cardstack/catalog/nested/card.gts'),
    ).toEqual({
      realm: '@cardstack/catalog/',
      path: 'nested/card.gts',
    });
  });

  it('returns undefined for a bare realm identifier', () => {
    expect(splitRealmResourceIdentifier('@cardstack/catalog/')).toBeUndefined();
    expect(splitRealmResourceIdentifier('@cardstack/catalog')).toBeUndefined();
  });

  it('returns undefined for URLs and non-cardstack scopes', () => {
    expect(
      splitRealmResourceIdentifier('http://localhost:4201/catalog/card.gts'),
    ).toBeUndefined();
    expect(
      splitRealmResourceIdentifier('@other/realm/card.gts'),
    ).toBeUndefined();
  });
});
