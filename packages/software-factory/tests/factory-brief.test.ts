import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { module, test } from 'qunit';

import {
  FactoryBriefError,
  loadFactoryBrief,
  normalizeFactoryBrief,
} from '../src/factory-brief';

const stickyNoteFixture = JSON.parse(
  readFileSync(resolve(__dirname, '../realm/Wiki/sticky-note.json'), 'utf8'),
) as unknown;
const darkfactoryTicketFixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../test-fixtures/darkfactory-adopter/Tickets/ticket-001.json',
    ),
    'utf8',
  ),
) as unknown;

module('factory-brief', function () {
  test('normalizeFactoryBrief extracts a stable shape from the sticky-note wiki card', function (assert) {
    let sourceUrl =
      'https://briefs.example.test/software-factory/Wiki/sticky-note';
    let brief = normalizeFactoryBrief(stickyNoteFixture, sourceUrl);

    assert.strictEqual(brief.title, 'Sticky Note');
    assert.strictEqual(brief.sourceUrl, sourceUrl);
    assert.strictEqual(
      brief.contentSummary,
      'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
    );
    assert.deepEqual(brief.tags, ['documents-content', 'sticky', 'note']);
  });

  test('normalizeFactoryBrief falls back when card fields are missing', function (assert) {
    let sourceUrl =
      'https://briefs.example.test/software-factory/Wiki/basic-brief';
    let brief = normalizeFactoryBrief(
      {
        data: {
          attributes: {
            content: 'Capture tasks on a simple board.',
          },
        },
      },
      sourceUrl,
    );

    assert.strictEqual(brief.title, 'Basic Brief');
    assert.strictEqual(
      brief.contentSummary,
      'Capture tasks on a simple board.',
    );
    assert.deepEqual(brief.tags, []);
  });

  test('normalizeFactoryBrief falls back to summary and description text when content is absent', function (assert) {
    let sourceUrl =
      'https://briefs.example.test/darkfactory-adopter/Tickets/ticket-001';
    let brief = normalizeFactoryBrief(darkfactoryTicketFixture, sourceUrl);

    assert.strictEqual(brief.title, 'Ticket 001');
    assert.strictEqual(
      brief.content,
      'Render tracker cards from an adopter realm using the public software-factory module URL.',
    );
    assert.strictEqual(
      brief.contentSummary,
      'Verify public DarkFactory adoption',
    );
  });

  test('normalizeFactoryBrief rejects malformed payloads', function (assert) {
    assert.throws(
      () =>
        normalizeFactoryBrief(
          { data: null },
          'https://briefs.example.test/bad',
        ),
      (error: unknown) =>
        error instanceof FactoryBriefError &&
        error.message ===
          'Expected brief card payload to include data.attributes',
    );
  });

  test('loadFactoryBrief passes an explicit authorization header when fetching and normalizing a brief', async function (assert) {
    assert.expect(4);

    let server = createServer((request, response) => {
      assert.strictEqual(request.url, '/software-factory/Wiki/sticky-note');
      assert.strictEqual(request.headers.accept, 'application/vnd.card+source');
      assert.strictEqual(request.headers.authorization, 'Bearer brief-token');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(stickyNoteFixture));
    });

    await new Promise<void>((resolvePromise) =>
      server.listen(0, resolvePromise),
    );
    let address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected test server to bind to a TCP port');
    }

    try {
      let brief = await loadFactoryBrief(
        `http://127.0.0.1:${address.port}/software-factory/Wiki/sticky-note`,
        {
          authorization: 'Bearer brief-token',
        },
      );

      assert.strictEqual(brief.title, 'Sticky Note');
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      );
    }
  });
});
