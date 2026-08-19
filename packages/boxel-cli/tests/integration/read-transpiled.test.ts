import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readTranspiledModule,
  type ReadTranspiledResult,
} from '../../src/commands/read-transpiled.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel read-transpiled <path> --realm <url> [--json]` fetches a realm
// module's transpiled JS. We drive the installed binary for the
// observable behaviors (compiled output, extension handling, 404s,
// no-profile). Two assertions inspect the exact outgoing request /
// force a fetch rejection — surfaces only reachable in-process — so they
// stay as in-process spies on the command function.

let home: string;
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
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

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

  let testHome = createTestHome();
  home = testHome.home;
  profileManager = testHome.profileManager;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('read-transpiled (integration)', () => {
  it('returns the compiled JavaScript for a .gts module (path with extension)', async () => {
    let res = await runBoxel(
      [
        'read-transpiled',
        'transpiled-check.gts',
        '--realm',
        realmUrl,
        '--json',
      ],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<ReadTranspiledResult>();

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
    let withExt = await runBoxel(
      [
        'read-transpiled',
        'transpiled-check.gts',
        '--realm',
        realmUrl,
        '--json',
      ],
      { home },
    );
    let withoutExt = await runBoxel(
      ['read-transpiled', 'transpiled-check', '--realm', realmUrl, '--json'],
      { home },
    );

    expect(withExt.ok, withExt.stderr).toBe(true);
    expect(withoutExt.ok, withoutExt.stderr).toBe(true);
    let withExtResult = withExt.json<ReadTranspiledResult>();
    let withoutExtResult = withoutExt.json<ReadTranspiledResult>();

    expect(withoutExtResult.ok).toBe(true);
    expect(withoutExtResult.status).toBe(200);
    expect(withoutExtResult.content).toBe(withExtResult.content);
  });

  it('uses authedRealmFetch with Accept: */*', async () => {
    // White-box: asserts the exact request the command function issues.
    // The outgoing fetch shape isn't observable across the subprocess
    // boundary, so this stays an in-process spy on the command function.
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
    let res = await runBoxel(
      ['read-transpiled', 'does-not-exist', '--realm', realmUrl, '--json'],
      { home },
    );
    expect(res.exitCode).toBe(1);
    let result = res.json<ReadTranspiledResult>();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
  });

  it('exits non-zero with a clear error when there is no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    try {
      let res = await runBoxel(
        ['read-transpiled', 'transpiled-check.gts', '--realm', realmUrl],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it('returns error when fetch throws', async () => {
    // White-box: forces the underlying fetch to reject, which is only
    // possible by mocking the command function's authenticator
    // in-process.
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
