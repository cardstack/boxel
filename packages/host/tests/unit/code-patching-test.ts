import { module, test } from 'qunit';

import { parseSearchReplace } from '@cardstack/host/lib/search-replace-block-parsing';

module(
  'Unit | code patching | parse search replace blocks',
  function (_assert) {
    test('will parse a search replace block when search block is incomplete', async function (assert) {
      let block = `__META: { "fileUrl": "https://example.com/paste.txt" }
<<<<<<< SEARCH
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>`;

      let result = parseSearchReplace(block);
      assert.strictEqual(
        result.searchContent,
        `            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>`,
      );
      assert.strictEqual(result.replaceContent, null);
    });

    test('will parse a search replace block when replace block is complete', async function (assert) {
      let block = `__META: { "fileUrl": "https://example.com/paste.txt" }
<<<<<<< SEARCH
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
=======`;
      let result = parseSearchReplace(block);
      assert.strictEqual(
        result.searchContent,
        `            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>`,
      );
      assert.strictEqual(result.replaceContent, null);
    });

    test('will parse an incomplete replace block', async function (assert) {
      let block = `<<<<<<< SEARCH
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>
=======
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>

            <div class='detail-item'>
              <span class='label'>Where:</span>
              <span class='value'>123 Party Lane, Celebration City</span>`;

      let result = parseSearchReplace(block);
      assert.strictEqual(
        result.searchContent,
        `            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>`,
      );

      assert.strictEqual(
        result.replaceContent,
        `            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>

            <div class='detail-item'>
              <span class='label'>Where:</span>
              <span class='value'>123 Party Lane, Celebration City</span>`,
      );
    });

    test('will parse a complete search replace block', async function (assert) {
      let block = `__META: { "fileUrl": "https://example.com/paste.txt" }
<<<<<<< SEARCH
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>
=======
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>

            <div class='detail-item'>
              <span class='label'>Where:</span>
              <span class='value'>123 Party Lane, Celebration City</span>
            </div>
          </div>

          <div class='rsvp-section'>
>>>>>>> REPLACE`;

      let result = parseSearchReplace(block);
      assert.strictEqual(
        result.searchContent,
        `            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>`,
      );

      assert.strictEqual(
        result.replaceContent,
        `            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>

            <div class='detail-item'>
              <span class='label'>Where:</span>
              <span class='value'>123 Party Lane, Celebration City</span>
            </div>
          </div>

          <div class='rsvp-section'>`,
      );
    });
  },
);
