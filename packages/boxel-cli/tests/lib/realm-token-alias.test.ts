import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProfileManager } from '../../src/lib/profile-manager.ts';

// The base realm is registered — and tokened by `_realm-auth` — under its
// `https://cardstack.com/base/` alias, but served over HTTP at
// `<realm-server>/base/`. Token lookup must bridge that aliasing or every
// profile-auth request to the serving URL fails with "No realm token
// available" despite _realm-auth having issued one.

const SERVER_URL = 'https://realms.example.test/';

let pm: ProfileManager;
let configDir: string;

beforeEach(async () => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-token-alias-'));
  pm = new ProfileManager(configDir);
  await pm.addProfileWithAuth(
    '@cli-test:example.test',
    {
      accessToken: 'test-access-token',
      userId: '@cli-test:example.test',
      deviceId: 'CLI_TEST_DEVICE',
      matrixUrl: 'https://matrix.example.test/',
    },
    'CLI Test User',
    SERVER_URL,
  );
  pm.setRealmToken('https://cardstack.com/base/', 'Bearer base-token');
  pm.setRealmToken(`${SERVER_URL}catalog/`, 'Bearer catalog-token');
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe('realm token lookup across the cardstack.com alias', () => {
  it('matches a cardstack.com-aliased token for a serving-host URL', async () => {
    let token = await pm.getRealmTokenForUrl(`${SERVER_URL}base/card-api.gts`);
    expect(token).toBe('Bearer base-token');
  });

  it('still matches tokens keyed by their serving URL directly', async () => {
    let token = await pm.getRealmTokenForUrl(`${SERVER_URL}catalog/foo.json`);
    expect(token).toBe('Bearer catalog-token');
  });

  it('matches the canonical alias URL itself unchanged', async () => {
    let token = await pm.getRealmTokenForUrl(
      'https://cardstack.com/base/card-api.gts',
    );
    expect(token).toBe('Bearer base-token');
  });

  it('does not surface the aliased token under a different realm path', async () => {
    // The exact-key getter shows the alias key is the only base entry;
    // the catalog URL must resolve to its own token, not base's.
    expect(pm.getRealmToken(`${SERVER_URL}base/`)).toBeUndefined();
    let token = await pm.getRealmTokenForUrl(`${SERVER_URL}catalog/bar.gts`);
    expect(token).toBe('Bearer catalog-token');
  });
});
