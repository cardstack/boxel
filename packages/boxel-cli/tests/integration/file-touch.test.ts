import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { touchFiles } from '../../src/commands/file/touch';
import { ProfileManager } from '../../src/lib/profile-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration';

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

function makeCardJson(title: string): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { title },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
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
      'cards/one.json': makeCardJson('One'),
      'cards/two.json': makeCardJson('Two'),
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

describe('file touch (integration)', () => {
  it('touching a .json file updates its mtime on the realm', async () => {
    let target = 'cards/one.json';
    let before = (await readMtimes())[`${realmUrl}${target}`];
    expect(before).toBeDefined();

    await new Promise((r) => setTimeout(r, 1100));

    let result = await touchFiles(realmUrl, [target], { profileManager });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.touched).toEqual([target]);
    expect(result.skipped).toEqual([]);

    let after = (await readMtimes())[`${realmUrl}${target}`];
    expect(after).toBeGreaterThan(before);
  });

  it('touching a .gts file updates its mtime', async () => {
    let target = 'touch-check.gts';
    let before = (await readMtimes())[`${realmUrl}${target}`];
    expect(before).toBeDefined();

    await new Promise((r) => setTimeout(r, 1100));

    let result = await touchFiles(realmUrl, [target], { profileManager });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.touched).toEqual([target]);

    let after = (await readMtimes())[`${realmUrl}${target}`];
    expect(after).toBeGreaterThan(before);
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
