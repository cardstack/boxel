import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  indexingErrors,
  shortErrorMessage,
  shortBrokenLinks,
  formatEntry,
  type IndexingErrorEntry,
  type BrokenLinkEntry,
} from '../../src/commands/realm/indexing-errors.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  getTestDbAdapter,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';

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

describe('realm indexing-errors (integration)', () => {
  it('returns ok with an empty data array for a healthy realm', async () => {
    let result = await indexingErrors(realmUrl, { profileManager });
    expect(result.ok).toBe(true);
    expect(result.document).toBeDefined();
    expect(Array.isArray(result.document!.data)).toBe(true);
    expect(result.document!.data).toEqual([]);
  });

  it('reports errored entries with errorDoc and diagnostics', async () => {
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
    let diagnostics = { invalidationId: 'inv-cli-test-1', ms: 17 };

    // Seed via direct INSERT rather than fullIndex() because this suite's
    // noopPrerenderer cannot extract types from `.gts` modules — any
    // .gts seeded in the fileSystem would land as a "File extract error"
    // row and poison the empty-realm assertion above. Only `boxel_index`
    // is needed since the /_indexing-errors endpoint reads it directly.
    await dbAdapter!.execute(
      `INSERT INTO boxel_index
         (url, file_alias, type, realm_version, realm_url,
          has_error, error_doc, diagnostics, is_deleted)
       VALUES ($1, $2, 'instance', 1, $3,
               TRUE, $4::jsonb, $5::jsonb, FALSE)`,
      {
        bind: [
          cardURL,
          fileAlias,
          realmUrl,
          JSON.stringify(errorDoc),
          JSON.stringify(diagnostics),
        ],
      },
    );

    let result = await indexingErrors(realmUrl, { profileManager });
    expect(result.ok).toBe(true);
    expect(result.document!.data.length).toBe(1);

    let entry = result.document!.data[0] as IndexingErrorEntry;
    expect(entry.type).toBe('indexing-error');
    expect(entry.id).toBe(`instance::${cardURL}`);
    expect(entry.attributes.url).toBe(cardURL);
    expect(entry.attributes.entryType).toBe('instance');
    expect(entry.attributes.errorDoc).toEqual(errorDoc);
    expect(entry.attributes.diagnostics).toEqual(diagnostics);
  });

  it('disambiguates same URL with different entry types', async () => {
    let dbAdapter = getTestDbAdapter();
    let sharedURL = `${realmUrl}two-row-error.json`;
    let fileAlias = `${realmUrl}two-row-error`;
    let instanceError = {
      message: 'instance render failed',
      status: 500,
      title: 'RenderError',
    };
    let fileError = {
      message: 'file extract failed',
      status: 500,
      title: 'FileExtractError',
    };

    for (let [type, errorDoc] of [
      ['instance', instanceError],
      ['file', fileError],
    ] as const) {
      await dbAdapter!.execute(
        `INSERT INTO boxel_index
           (url, file_alias, type, realm_version, realm_url,
            has_error, error_doc, is_deleted)
         VALUES ($1, $2, $3, 1, $4, TRUE, $5::jsonb, FALSE)`,
        {
          bind: [
            sharedURL,
            fileAlias,
            type,
            realmUrl,
            JSON.stringify(errorDoc),
          ],
        },
      );
    }

    let result = await indexingErrors(realmUrl, { profileManager });
    expect(result.ok).toBe(true);
    let forUrl = result.document!.data.filter(
      (e) => e.attributes.url === sharedURL,
    );
    expect(forUrl.length).toBe(2);
    let ids = forUrl.map((e) => e.id).sort();
    expect(ids).toEqual([`file::${sharedURL}`, `instance::${sharedURL}`]);
    let byType = Object.fromEntries(
      forUrl.map((e) => [e.attributes.entryType, e]),
    );
    expect(
      (byType.instance as IndexingErrorEntry).attributes.errorDoc?.message,
    ).toBe(instanceError.message);
    expect(
      (byType.file as IndexingErrorEntry).attributes.errorDoc?.message,
    ).toBe(fileError.message);
  });

  it('surfaces broken-link rows with has_error = FALSE', async () => {
    let dbAdapter = getTestDbAdapter();
    let cardURL = `${realmUrl}broken-links-only.json`;
    let fileAlias = `${realmUrl}broken-links-only`;
    let brokenLinks = [
      {
        fieldName: 'author',
        reference: 'https://example.com/missing',
        kind: 'not-found',
      },
    ];
    let diagnostics = { brokenLinks };

    await dbAdapter!.execute(
      `INSERT INTO boxel_index
         (url, file_alias, type, realm_version, realm_url,
          has_error, error_doc, diagnostics, is_deleted)
       VALUES ($1, $2, 'instance', 1, $3,
               FALSE, NULL, $4::jsonb, FALSE)`,
      {
        bind: [cardURL, fileAlias, realmUrl, JSON.stringify(diagnostics)],
      },
    );

    let result = await indexingErrors(realmUrl, { profileManager });
    expect(result.ok).toBe(true);
    let entry = result.document!.data.find(
      (e) => e.attributes.url === cardURL,
    ) as BrokenLinkEntry | undefined;
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('broken-link');
    expect(entry!.attributes.brokenLinks).toEqual(brokenLinks);
    expect(formatEntry(entry!)).toContain('1 broken: author→');
  });

  it('returns ok=false when the realm is unreachable', async () => {
    let result = await indexingErrors('http://127.0.0.1:1/fake/', {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns NO_ACTIVE_PROFILE_ERROR when no profile is active', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await indexingErrors(realmUrl, {
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
    expect(shortErrorMessage({})).toBe('<no message>');
  });

  it('shortBrokenLinks summarizes broken-link findings', () => {
    expect(shortBrokenLinks(null)).toBe('<no broken links>');
    expect(shortBrokenLinks([])).toBe('<no broken links>');
    expect(
      shortBrokenLinks([
        { fieldName: 'a', reference: 'x', kind: 'not-found' },
        { fieldName: 'b', reference: 'y', kind: 'error' },
      ]),
    ).toBe('2 broken: a→x, b→y');
    expect(
      shortBrokenLinks([
        { fieldName: 'a', reference: 'x', kind: 'not-found' },
        { fieldName: 'b', reference: 'y', kind: 'error' },
        { fieldName: 'c', reference: 'z', kind: 'error' },
        { fieldName: 'd', reference: 'w', kind: 'error' },
      ]),
    ).toBe('4 broken: a→x, b→y, c→z, …+1 more');
  });
});
