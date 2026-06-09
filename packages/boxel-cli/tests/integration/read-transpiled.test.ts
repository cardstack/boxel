import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readTranspiledModule } from '../../src/commands/read-transpiled.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let realmUrl: string;

// A minimal .gts card module with a decorator so transpilation has
// something visible to do (TypeScript + decorator lowering). We avoid
// <template> tags in the CLI harness because the content-tag global
// that compiles templates isn't wired into this runner — the
// software-factory Playwright spec covers the <template> path against
// a real browser.
const SOURCE_GTS = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class TranspiledCheck extends CardDef {
  static displayName = 'Transpiled Check';
  @field label = contains(StringField);
}
`;

beforeAll(async () => {
  // Seed the .gts module into the realm at creation time so we don't
  // depend on indexing side-effects in the stubbed-prerenderer harness.
  await startTestRealmServer({
    fileSystem: {
      'transpiled-check.gts': SOURCE_GTS,
    },
  });

  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;

  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('read-transpiled (integration)', () => {
  it('returns the compiled JavaScript for a .gts module (path with extension)', async () => {
    let result = await readTranspiledModule(realmUrl, 'transpiled-check.gts', {
      profileManager,
    });

    expect(
      result.ok,
      `readTranspiledModule failed: ${JSON.stringify(result)}`,
    ).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toBeTruthy();
    expect(result.content!.length).toBeGreaterThan(0);

    // The response must be the transpiled output, not the raw source.
    expect(result.content).not.toBe(SOURCE_GTS);

    // The `@field` decorator-assignment syntax is TS source-only; after
    // transpilation it's lowered to a decorator-transform helper call
    // (e.g., `dt7948.g(this.prototype, "label", [field], ...)`). The
    // source-level `@field ` token must be gone — a stable marker that
    // doesn't depend on the specific helper names the compiler emits or
    // on whether the output is ES modules vs AMD.
    expect(result.content).not.toMatch(/@field\s/);
  });

  it('accepts the path without the .gts extension', async () => {
    let withExt = await readTranspiledModule(realmUrl, 'transpiled-check.gts', {
      profileManager,
    });
    let withoutExt = await readTranspiledModule(realmUrl, 'transpiled-check', {
      profileManager,
    });

    expect(withoutExt.ok).toBe(true);
    expect(withoutExt.status).toBe(200);
    expect(withoutExt.content).toBe(withExt.content);
  });

  it('uses authedRealmFetch with Accept: */*', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      await readTranspiledModule(realmUrl, 'transpiled-check.gts', {
        profileManager,
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('transpiled-check.gts');
      expect(init!.method).toBe('GET');
      let headers = init!.headers as Record<string, string>;
      expect(headers['Accept']).toBe('*/*');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns a not-ok result with 404 status for a nonexistent module', async () => {
    let result = await readTranspiledModule(realmUrl, 'does-not-exist', {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    await expect(
      readTranspiledModule(realmUrl, 'transpiled-check.gts', {
        profileManager: emptyManager,
      }),
    ).rejects.toThrow('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('returns error when fetch throws', async () => {
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmFetch')
      .mockRejectedValueOnce(new Error('network failure'));
    try {
      let result = await readTranspiledModule(
        realmUrl,
        'transpiled-check.gts',
        { profileManager },
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('network failure');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
