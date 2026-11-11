import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ProfileManager,
  type ProfilesConfig,
} from '../../src/lib/profile-manager.ts';
import type { MatrixAuth } from '../../src/lib/auth.ts';

// `selectProfile` is what `--profile` and `BOXEL_PROFILE` reach: one process
// acts as a saved profile other than the active one, and the profiles file —
// which every other terminal and agent session on the machine reads — keeps
// the active profile it had.

const ALICE = '@alice:example.test';
const BOB = '@bob:example.test';
const ALICE_SERVER = 'https://alice-realms.example.test/';
const BOB_SERVER = 'https://bob-realms.example.test/';

function auth(matrixId: string, accessToken = `token-for-${matrixId}`) {
  return {
    accessToken,
    userId: matrixId,
    deviceId: 'DEVICE',
    matrixUrl: 'https://matrix.example.test/',
  } satisfies MatrixAuth;
}

let configDir: string;

function readStore(): ProfilesConfig {
  return JSON.parse(
    fs.readFileSync(path.join(configDir, 'profiles.json'), 'utf-8'),
  );
}

beforeEach(async () => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-select-'));
  let seed = new ProfileManager(configDir);
  // The first profile added becomes the active one.
  await seed.addProfileWithAuth(ALICE, auth(ALICE), 'Alice', ALICE_SERVER);
  await seed.addProfileWithAuth(BOB, auth(BOB), 'Bob', BOB_SERVER);
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe('selectProfile', () => {
  it('acts as the selected profile without changing the active one on disk', () => {
    let pm = new ProfileManager(configDir);
    pm.selectProfile(BOB);

    expect(pm.getActiveProfile()?.id).toBe(BOB);
    expect(pm.getActiveProfile()?.profile.realmServerUrl).toBe(BOB_SERVER);
    expect(pm.getStoredMatrixAuth().userId).toBe(BOB);
    expect(readStore().activeProfile).toBe(ALICE);
    expect(new ProfileManager(configDir).getActiveProfileId()).toBe(ALICE);
  });

  it("saves tokens to the selected profile's entry, not the active one's", () => {
    let pm = new ProfileManager(configDir);
    pm.selectProfile(BOB);

    pm.setRealmServerToken('Bearer bob-server-token');
    pm.setRealmToken(`${BOB_SERVER}bob-realm/`, 'Bearer bob-realm-token');

    let store = readStore();
    expect(store.activeProfile).toBe(ALICE);
    expect(store.profiles[BOB].realmServerToken).toBe(
      'Bearer bob-server-token',
    );
    expect(store.profiles[BOB].realmTokens).toEqual({
      [`${BOB_SERVER}bob-realm/`]: 'Bearer bob-realm-token',
    });
    expect(store.profiles[ALICE].realmServerToken).toBeUndefined();
    expect(store.profiles[ALICE].realmTokens).toBeUndefined();
  });

  it('keeps a profile switch another process made while this one was running', () => {
    let running = new ProfileManager(configDir);
    running.selectProfile(BOB);

    // Another session switches the machine's active profile after this
    // process loaded the file.
    expect(new ProfileManager(configDir).switchProfile(BOB)).toBe(true);

    running.setRealmServerToken('Bearer bob-server-token');

    let store = readStore();
    expect(store.activeProfile).toBe(BOB);
    expect(store.profiles[BOB].realmServerToken).toBe(
      'Bearer bob-server-token',
    );
  });

  it("keeps another process's token refresh for a different profile", () => {
    let actingAsBob = new ProfileManager(configDir);
    actingAsBob.selectProfile(BOB);

    // Another session, acting as the active profile, refreshes its token.
    new ProfileManager(configDir).setRealmServerToken(
      'Bearer alice-server-token',
    );

    actingAsBob.setRealmServerToken('Bearer bob-server-token');

    let store = readStore();
    expect(store.profiles[ALICE].realmServerToken).toBe(
      'Bearer alice-server-token',
    );
    expect(store.profiles[BOB].realmServerToken).toBe(
      'Bearer bob-server-token',
    );
  });

  it('leaves the active profile alone when it re-signs the selected profile in', async () => {
    let pm = new ProfileManager(configDir, {
      isTty: () => true,
      promptPassword: async () => 'bob-password',
      matrixLogin: async (_matrixUrl, username) =>
        auth(`@${username}:example.test`, 'fresh-bob-token'),
    });
    pm.selectProfile(BOB);

    let fresh = await pm.reAuthenticate();

    expect(fresh.accessToken).toBe('fresh-bob-token');
    let store = readStore();
    expect(store.activeProfile).toBe(ALICE);
    expect(store.profiles[BOB].matrixAccessToken).toBe('fresh-bob-token');
    expect(store.profiles[ALICE].matrixAccessToken).toBe(`token-for-${ALICE}`);
  });

  it('replaces the profiles file whole, leaving no temporary file behind', () => {
    let pm = new ProfileManager(configDir);
    pm.selectProfile(BOB);
    pm.setRealmServerToken('Bearer bob-server-token');

    expect(fs.readdirSync(configDir)).toEqual(['profiles.json']);
  });

  it('refuses a profile that is not saved, naming the saved ones', () => {
    let pm = new ProfileManager(configDir);

    expect(() => pm.selectProfile('@carol:example.test')).toThrow(
      `No profile named "@carol:example.test". Saved profiles: ${ALICE}, ${BOB}. Run \`boxel profile list\` to see your profiles.`,
    );
    expect(pm.getActiveProfileId()).toBe(ALICE);
  });

  it('matches the profile ID exactly', () => {
    let pm = new ProfileManager(configDir);

    expect(() => pm.selectProfile('bob')).toThrow(/No profile named "bob"/);
  });

  it('refuses a profile with no stored session', () => {
    let store = readStore();
    store.profiles[BOB].matrixAccessToken = '';
    fs.writeFileSync(
      path.join(configDir, 'profiles.json'),
      JSON.stringify(store),
    );
    let pm = new ProfileManager(configDir);

    expect(() => pm.selectProfile(BOB)).toThrow(
      `Profile "${BOB}" has no stored Matrix access token. Run \`boxel profile add\` to re-authenticate.`,
    );
    expect(pm.getActiveProfileId()).toBe(ALICE);
  });

  it('refuses when the profiles file cannot be read', () => {
    fs.writeFileSync(path.join(configDir, 'profiles.json'), '{ not json');
    let pm = new ProfileManager(configDir);

    expect(() => pm.selectProfile(BOB)).toThrow(/Could not read profiles file/);
  });
});
