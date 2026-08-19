import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  shortErrorMessage,
  shortBrokenLinks,
  shortFrontmatterError,
  formatEntry,
  type IndexingErrorsDocument,
  type IndexingErrorEntry,
  type BrokenLinkEntry,
  type FrontmatterErrorEntry,
} from '../../src/commands/realm/indexing-errors.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  getTestDbAdapter,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// Drives `boxel realm indexing-errors --realm <url> --json` as a subprocess
// and asserts on the JSON-API document it prints. Error rows are seeded
// directly into `boxel_index` in-process (the noopPrerenderer can't produce
// them from source) — only the command that surfaces them is a subprocess
// call. The `formatEntry` / `short*` helpers remain unit-tested in-process.

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;

// Run the command under test as a subprocess and return the parsed
// JSON-API document. The command must succeed; failures surface via stderr.
async function fetchIndexingErrors(): Promise<IndexingErrorsDocument> {
  let res = await runBoxel(
    ['realm', 'indexing-errors', '--realm', realmUrl, '--json'],
    { home },
  );
  expect(res.ok, res.stderr).toBe(true);
  return res.json<IndexingErrorsDocument>();
}

beforeAll(async () => {
  // Boot a clean realm with no fileSystem — the noopPrerenderer can't
  // extract types from card .gts modules, so any seeded card would show
  // up as a "File extract error" row and poison the first test's
  // empty-realm assertion. Tests that need errors seed them directly
  // via INSERT below.
  await startTestRealmServer();
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm indexing-errors (integration)', () => {
  it('returns ok with an empty data array for a healthy realm', async () => {
    let document = await fetchIndexingErrors();
    expect(Array.isArray(document.data)).toBe(true);
    expect(document.data).toEqual([]);
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
         (url, file_alias, type, generation, realm_url,
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

    let document = await fetchIndexingErrors();
    expect(document.data.length).toBe(1);

    let entry = document.data[0] as IndexingErrorEntry;
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
           (url, file_alias, type, generation, realm_url,
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

    let document = await fetchIndexingErrors();
    let forUrl = document.data.filter((e) => e.attributes.url === sharedURL);
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
         (url, file_alias, type, generation, realm_url,
          has_error, error_doc, diagnostics, is_deleted)
       VALUES ($1, $2, 'instance', 1, $3,
               FALSE, NULL, $4::jsonb, FALSE)`,
      {
        bind: [cardURL, fileAlias, realmUrl, JSON.stringify(diagnostics)],
      },
    );

    let document = await fetchIndexingErrors();
    let entry = document.data.find((e) => e.attributes.url === cardURL) as
      | BrokenLinkEntry
      | undefined;
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('broken-link');
    expect(entry!.attributes.brokenLinks).toEqual(brokenLinks);
    expect(formatEntry(entry!)).toContain('1 broken: author→');
  });

  it('surfaces frontmatter-error rows with has_error = FALSE', async () => {
    let dbAdapter = getTestDbAdapter();
    let fileURL = `${realmUrl}skills/bad/SKILL.md`;
    let fileAlias = `${realmUrl}skills/bad/SKILL`;
    let frontmatterParseError = {
      message: 'Implicit map keys need to be on a single line',
      line: 4,
      column: 3,
    };
    let diagnostics = { frontmatterParseError };

    await dbAdapter!.execute(
      `INSERT INTO boxel_index
         (url, file_alias, type, generation, realm_url,
          has_error, error_doc, diagnostics, is_deleted)
       VALUES ($1, $2, 'file', 1, $3,
               FALSE, NULL, $4::jsonb, FALSE)`,
      {
        bind: [fileURL, fileAlias, realmUrl, JSON.stringify(diagnostics)],
      },
    );

    let document = await fetchIndexingErrors();
    let entry = document.data.find((e) => e.attributes.url === fileURL) as
      | FrontmatterErrorEntry
      | undefined;
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('frontmatter-error');
    expect(entry!.attributes.frontmatterParseError).toEqual(
      frontmatterParseError,
    );
    expect(formatEntry(entry!)).toContain('frontmatter parse error (line 4:3)');
  });

  it('surfaces both findings when a healthy row has broken links AND a frontmatter error', async () => {
    let dbAdapter = getTestDbAdapter();
    let fileURL = `${realmUrl}skills/both/SKILL.md`;
    let fileAlias = `${realmUrl}skills/both/SKILL`;
    let frontmatterParseError = {
      message: 'Implicit map keys need to be on a single line',
      line: 4,
      column: 3,
    };
    let brokenLinks = [
      {
        fieldName: 'related',
        reference: 'https://example.com/missing',
        kind: 'not-found',
      },
    ];
    let diagnostics = { frontmatterParseError, brokenLinks };

    await dbAdapter!.execute(
      `INSERT INTO boxel_index
         (url, file_alias, type, generation, realm_url,
          has_error, error_doc, diagnostics, is_deleted)
       VALUES ($1, $2, 'file', 1, $3,
               FALSE, NULL, $4::jsonb, FALSE)`,
      {
        bind: [fileURL, fileAlias, realmUrl, JSON.stringify(diagnostics)],
      },
    );

    let document = await fetchIndexingErrors();
    let forUrl = document.data.filter((e) => e.attributes.url === fileURL);
    expect(forUrl.length).toBe(2);
    let byType = Object.fromEntries(forUrl.map((e) => [e.type, e]));

    let frontmatterEntry = byType['frontmatter-error'] as FrontmatterErrorEntry;
    expect(frontmatterEntry).toBeDefined();
    expect(frontmatterEntry.attributes.frontmatterParseError).toEqual(
      frontmatterParseError,
    );
    expect(formatEntry(frontmatterEntry)).toContain(
      'frontmatter parse error (line 4:3)',
    );

    let brokenLinkEntry = byType['broken-link'] as BrokenLinkEntry;
    expect(brokenLinkEntry).toBeDefined();
    expect(brokenLinkEntry.attributes.brokenLinks).toEqual(brokenLinks);
    expect(formatEntry(brokenLinkEntry)).toContain('1 broken: related→');
  });

  it('returns ok=false when the realm is unreachable', async () => {
    let res = await runBoxel(
      ['realm', 'indexing-errors', '--realm', 'http://127.0.0.1:1/fake/'],
      { home },
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).not.toBe('');
  });

  it('returns NO_ACTIVE_PROFILE_ERROR when no profile is active', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    try {
      let res = await runBoxel(
        ['realm', 'indexing-errors', '--realm', realmUrl],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
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

  it('shortFrontmatterError renders message with optional position', () => {
    expect(shortFrontmatterError(null)).toBe('<no frontmatter error>');
    expect(shortFrontmatterError({ message: 'bad yaml' })).toBe(
      'frontmatter parse error: bad yaml',
    );
    expect(
      shortFrontmatterError({ message: 'bad yaml', line: 4, column: 3 }),
    ).toBe('frontmatter parse error (line 4:3): bad yaml');
    expect(shortFrontmatterError({ message: 'bad yaml', line: 4 })).toBe(
      'frontmatter parse error (line 4): bad yaml',
    );
  });
});
