import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  indexingStatus,
  shortErrorMessage,
  type IndexingErrorEntry,
} from '../../src/commands/realm/indexing-status';
import { ProfileManager } from '../../src/lib/profile-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  getTestDbAdapter,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let realmUrl: string;

beforeAll(async () => {
  // Boot a clean realm with no fileSystem — the noopPrerenderer can't
  // extract types from card .gts modules, so any seeded card would show
  // up as a "File extract error" row and poison the first test's
  // empty-realm assertion. Tests that need errors seed them directly
  // via INSERT below.
  await startTestRealmServer();
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

describe('realm indexing-status (integration)', () => {
  it('returns ok with an empty data array for a healthy realm', async () => {
    let result = await indexingStatus(realmUrl, { profileManager });
    expect(result.ok).toBe(true);
    expect(result.document).toBeDefined();
    expect(Array.isArray(result.document!.data)).toBe(true);
    expect(result.document!.data).toEqual([]);
  });

  it('reports errored entries with errorDoc and timingDiagnostics', async () => {
    let dbAdapter = getTestDbAdapter();
    expect(dbAdapter).toBeDefined();

    let cardURL = `${realmUrl}injected-error.json`;
    let fileAlias = `${realmUrl}injected-error`;
    let errorDoc = {
      message: 'render failed: missing module',
      status: 500,
      title: 'RenderError',
      additionalErrors: null,
    };
    let timingDiagnostics = { invalidationId: 'inv-cli-test-1', ms: 17 };

    for (let table of ['boxel_index', 'boxel_index_working']) {
      await dbAdapter!.execute(
        `INSERT INTO ${table}
           (url, file_alias, type, realm_version, realm_url,
            has_error, error_doc, timing_diagnostics, is_deleted)
         VALUES ($1, $2, 'instance', 1, $3,
                 TRUE, $4::jsonb, $5::jsonb, FALSE)`,
        {
          bind: [
            cardURL,
            fileAlias,
            realmUrl,
            JSON.stringify(errorDoc),
            JSON.stringify(timingDiagnostics),
          ],
        },
      );
    }

    let result = await indexingStatus(realmUrl, { profileManager });
    expect(result.ok).toBe(true);
    expect(result.document!.data.length).toBe(1);

    let entry = result.document!.data[0] as IndexingErrorEntry;
    expect(entry.type).toBe('indexing-error');
    expect(entry.id).toBe(cardURL);
    expect(entry.attributes.errorDoc).toEqual(errorDoc);
    expect(entry.attributes.timingDiagnostics).toEqual(timingDiagnostics);
  });

  it('returns ok=false when the realm is unreachable', async () => {
    let result = await indexingStatus('http://127.0.0.1:1/fake/', {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns NO_ACTIVE_PROFILE_ERROR when no profile is active', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await indexingStatus(realmUrl, {
      profileManager: emptyManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('shortErrorMessage prefers title over message and collapses whitespace', () => {
    expect(
      shortErrorMessage({ title: 'Boom', message: 'long message here' }),
    ).toBe('Boom');
    expect(shortErrorMessage({ message: 'multi\n  line\t message' })).toBe(
      'multi line message',
    );
    expect(shortErrorMessage(null)).toBe('<no error document>');
    expect(shortErrorMessage({}).startsWith('<no message>')).toBe(true);
  });
});
