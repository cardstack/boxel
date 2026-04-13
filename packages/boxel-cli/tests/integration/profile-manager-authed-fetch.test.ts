import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRealm } from '../../src/commands/realm/create';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration';
import type { ProfileManager } from '../../src/lib/profile-manager';

let profileManager: ProfileManager;
let cleanup: () => void;

beforeAll(async () => {
  await startTestRealmServer();

  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanup = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanup?.();
  await stopTestRealmServer();
});

describe('ProfileManager.authedFetch with realmUrl routing (integration)', () => {
  it('attaches the stored per-realm JWT when given { realmUrl }', async () => {
    let endpoint = uniqueRealmName();
    await createRealm(endpoint, `Test ${endpoint}`, { profileManager });

    let realmEntry = Object.entries(
      profileManager.getActiveProfile()!.profile.realmTokens ?? {},
    ).find(([url]) => url.includes(endpoint));
    expect(realmEntry).toBeDefined();
    let [realmUrl, realmToken] = realmEntry!;

    let capturedAuth: string | null = null;
    let originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      capturedAuth = new Headers(init?.headers).get('Authorization');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    try {
      await profileManager.authedFetch(`${realmUrl}_info`, undefined, {
        realmUrl,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(capturedAuth).toBe(realmToken);
  });
});
