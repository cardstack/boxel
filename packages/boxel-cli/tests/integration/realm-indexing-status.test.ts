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
let realmServerResult: Awaited<ReturnType<typeof startTestRealmServer>>;

beforeAll(async () => {
  realmServerResult = await startTestRealmServer({
    fileSystem: {
      'broken-card.gts': `
        import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        export class BrokenCard extends CardDef {
          @field title = contains(StringField);
        }
      `,
      'broken-instance.json': {
        data: {
          type: 'card',
          attributes: { cardTitle: 'Broken' },
          meta: {
            adoptsFrom: {
              module: './broken-card',
              name: 'BrokenCard',
            },
          },
        },
      },
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

    let cardURL = `${realmUrl}broken-instance.json`;
    let errorDoc = {
      message: 'render failed: missing module',
      status: 500,
      title: 'RenderError',
      additionalErrors: null,
    };
    let timingDiagnostics = { invalidationId: 'inv-cli-test-1', ms: 17 };

    // Ensure the realm is indexed so the broken-instance row exists.
    let realm = realmServerResult.realms.find((r) => r.url === realmUrl);
    expect(realm).toBeDefined();
    await realm!.realmIndexUpdater.fullIndex();

    for (let table of ['boxel_index', 'boxel_index_working']) {
      await dbAdapter!.execute(
        `UPDATE ${table}
         SET has_error = TRUE,
             error_doc = $1::jsonb,
             timing_diagnostics = $2::jsonb
         WHERE url = $3 AND type = 'instance'`,
        {
          bind: [
            JSON.stringify(errorDoc),
            JSON.stringify(timingDiagnostics),
            cardURL,
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
