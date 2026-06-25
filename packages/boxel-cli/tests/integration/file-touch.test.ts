import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { touchFiles } from '../../src/commands/file/touch.ts';
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

const SOURCE_GTS = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class TouchCheck extends CardDef {
  static displayName = 'Touch Check';
  @field label = contains(StringField);
}
`;

// Contains the marker text inside a string literal to verify that touchGts
// only toggles the dedicated trailing line, not arbitrary occurrences.
const SOURCE_GTS_WITH_MARKER_IN_STRING = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class MarkerInString extends CardDef {
  static displayName = 'Marker In String';
  static markerHint = '// touched for re-index';
  @field label = contains(StringField);
}
`;

function makeCardJson(title: string): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { title },
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/card-api',
            name: 'CardDef',
          },
        },
      },
    },
    null,
    2,
  );
}

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: {
      'touch-check.gts': SOURCE_GTS,
      'marker-in-string.gts': SOURCE_GTS_WITH_MARKER_IN_STRING,
      'cards/one.json': makeCardJson('One'),
      'cards/two.json': makeCardJson('Two'),
      'cards/three.json': makeCardJson('Three'),
      'cards/four.json': makeCardJson('Four'),
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

async function readMtimes(): Promise<Record<string, number>> {
  let response = await profileManager.authedRealmFetch(`${realmUrl}_mtimes`, {
    method: 'GET',
    headers: { Accept: 'application/vnd.api+json' },
  });
  let json = (await response.json()) as {
    data?: { attributes?: { mtimes?: Record<string, number> } };
  };
  return (
    json?.data?.attributes?.mtimes ??
    (json as unknown as Record<string, number>)
  );
}

async function readFileContent(relPath: string): Promise<string> {
  let response = await profileManager.authedRealmFetch(
    `${realmUrl}${relPath}`,
    {
      method: 'GET',
      headers: { Accept: 'application/vnd.card+source' },
    },
  );
  return response.text();
}

async function writeFileContent(
  relPath: string,
  content: string,
): Promise<void> {
  await profileManager.authedRealmFetch(`${realmUrl}${relPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.card+source' },
    body: content,
  });
}

describe('file touch (integration)', () => {
  it('touching a .json file updates its mtime on the realm', async () => {
    let target = 'cards/one.json';
    let before = (await readMtimes())[`${realmUrl}${target}`];
    expect(before).toBeDefined();

    // mtime is second-resolution on most filesystems; sleep > 1s so we can
    // reliably observe a change.
    await new Promise((r) => setTimeout(r, 1100));

    let result = await touchFiles(realmUrl, [target], { profileManager });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.touched).toEqual([target]);
    expect(result.skipped).toEqual([]);

    let after = (await readMtimes())[`${realmUrl}${target}`];
    expect(after).toBeGreaterThan(before);
  });

  it('touching a .json file persists `_touched` in `meta`', async () => {
    let target = 'cards/three.json';
    let before = Date.now();
    let result = await touchFiles(realmUrl, [target], { profileManager });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    let content = await readFileContent(target);
    let parsed = JSON.parse(content) as {
      data: { meta: { _touched?: number } };
    };
    expect(typeof parsed.data.meta._touched).toBe('number');
    expect(parsed.data.meta._touched!).toBeGreaterThanOrEqual(before);
  });

  it('touching a .gts file updates its mtime', async () => {
    let target = 'touch-check.gts';
    let before = (await readMtimes())[`${realmUrl}${target}`];
    expect(before).toBeDefined();

    // mtime is second-resolution on most filesystems; sleep > 1s so we can
    // reliably observe a change.
    await new Promise((r) => setTimeout(r, 1100));

    let result = await touchFiles(realmUrl, [target], { profileManager });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.touched).toEqual([target]);

    let after = (await readMtimes())[`${realmUrl}${target}`];
    expect(after).toBeGreaterThan(before);
  });

  it('touching a .gts file toggles the `// touched for re-index` comment', async () => {
    let target = 'touch-check.gts';
    let initial = await readFileContent(target);
    let initiallyHasComment = initial.includes('// touched for re-index');

    let firstTouch = await touchFiles(realmUrl, [target], { profileManager });
    expect(firstTouch.ok, JSON.stringify(firstTouch)).toBe(true);
    let afterFirst = await readFileContent(target);
    expect(afterFirst.includes('// touched for re-index')).toBe(
      !initiallyHasComment,
    );

    let secondTouch = await touchFiles(realmUrl, [target], { profileManager });
    expect(secondTouch.ok, JSON.stringify(secondTouch)).toBe(true);
    let afterSecond = await readFileContent(target);
    expect(afterSecond.includes('// touched for re-index')).toBe(
      initiallyHasComment,
    );
  });

  it('--all enumerates and touches every .json and .gts in the realm', async () => {
    let result = await touchFiles(realmUrl, [], {
      all: true,
      profileManager,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.touched).toContain('touch-check.gts');
    expect(result.touched).toContain('cards/one.json');
    expect(result.touched).toContain('cards/two.json');
    expect(result.skipped).toEqual([]);
  });

  it('touching a .gts that contains the marker text inside a string literal leaves the literal intact and round-trips', async () => {
    let target = 'marker-in-string.gts';
    let countMarker = (s: string) =>
      (s.match(/\/\/ touched for re-index/g) ?? []).length;
    // Earlier tests (notably --all) may have appended the marker to this
    // shared fixture; reset to a known baseline so this test is independent.
    await writeFileContent(target, SOURCE_GTS_WITH_MARKER_IN_STRING);
    let original = await readFileContent(target);
    expect(original).toContain(`'// touched for re-index'`);
    expect(countMarker(original)).toBe(1);

    let firstTouch = await touchFiles(realmUrl, [target], { profileManager });
    expect(firstTouch.ok, JSON.stringify(firstTouch)).toBe(true);

    let afterFirst = await readFileContent(target);
    // Exactly one new marker — the original in-string occurrence survived.
    expect(countMarker(afterFirst)).toBe(2);
    expect(afterFirst).toContain(
      `static markerHint = '// touched for re-index';`,
    );

    let secondTouch = await touchFiles(realmUrl, [target], { profileManager });
    expect(secondTouch.ok, JSON.stringify(secondTouch)).toBe(true);

    let afterSecond = await readFileContent(target);
    // The appended marker was removed, the in-string one is still there.
    expect(countMarker(afterSecond)).toBe(1);
    expect(afterSecond).toContain(
      `static markerHint = '// touched for re-index';`,
    );
  });

  it('--dry-run reports the planned touches without writing', async () => {
    let target = 'cards/two.json';
    let before = (await readMtimes())[`${realmUrl}${target}`];

    let result = await touchFiles(realmUrl, [target], {
      dryRun: true,
      profileManager,
    });
    expect(result.ok).toBe(true);
    expect(result.touched).toEqual([target]);

    // mtime should not have changed
    let after = (await readMtimes())[`${realmUrl}${target}`];
    expect(after).toBe(before);
  });

  it('skips files with unsupported extensions', async () => {
    let result = await touchFiles(realmUrl, ['cards/note.txt'], {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.touched).toEqual([]);
    expect(result.skipped).toEqual([
      { path: 'cards/note.txt', reason: 'unsupported extension' },
    ]);
  });

  it('skips paths that 404 on the realm', async () => {
    let result = await touchFiles(realmUrl, ['cards/does-not-exist.json'], {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.touched).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].path).toBe('cards/does-not-exist.json');
    expect(result.skipped[0].reason).toContain('404');
  });

  it('--dry-run skips paths that would 404 instead of reporting them as touched', async () => {
    let result = await touchFiles(realmUrl, ['cards/missing.json'], {
      dryRun: true,
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.touched).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].path).toBe('cards/missing.json');
    expect(result.skipped[0].reason).toContain('404');
  });

  it('returns error when no paths and no --all', async () => {
    let result = await touchFiles(realmUrl, [], { profileManager });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No file paths provided');
  });

  it('returns error when paths combined with --all', async () => {
    let result = await touchFiles(realmUrl, ['cards/one.json'], {
      all: true,
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('--all');
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    let result = await touchFiles(realmUrl, ['cards/one.json'], {
      profileManager: emptyManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
