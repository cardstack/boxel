import { module, test } from 'qunit';

import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
} from '@cardstack/runtime-common';

import {
  isCompleteSearchReplaceBlock,
  parseSearchReplace,
} from '@cardstack/host/lib/search-replace-block-parsing';

module(
  'Unit | code patching | parse search replace blocks',
  function (_assert) {
    test('will parse a search replace block when search block is incomplete', async function (assert) {
      let block = `paste.txt
${SEARCH_MARKER}
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
      let block = `paste.txt
${SEARCH_MARKER}
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
${SEPARATOR_MARKER}`;
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
      let block = `${SEARCH_MARKER}
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>
${SEPARATOR_MARKER}
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
      let block = `paste.txt
${SEARCH_MARKER}
            <div class='detail-item'>
              <span class='label'>What:</span>
              <span class='value'>An afternoon of fun, games, and cake!</span>
            </div>
          </div>

          <div class='rsvp-section'>
${SEPARATOR_MARKER}
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
${REPLACE_MARKER}`;

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

    test('strips a stray extra separator the model emits before the REPLACE marker', async function (assert) {
      // Models sometimes duplicate the separator right before REPLACE_MARKER;
      // parsing must drop it rather than include it in replaceContent, where
      // it would reach the file as a line of box-drawing characters.
      let block = `game-1.json
${SEARCH_MARKER}
{ "old": true }
${SEPARATOR_MARKER}
{ "new": true }
${SEPARATOR_MARKER}
${REPLACE_MARKER}`;
      let result = parseSearchReplace(block);
      assert.strictEqual(result.searchContent, `{ "old": true }`);
      assert.strictEqual(
        result.replaceContent,
        `{ "new": true }`,
        'the stray separator is not part of the replacement',
      );
    });

    // The model writes the markers from memory and does not reliably reproduce
    // a bare run of ═. Observed in practice: the separator arrives with 19 ═
    // instead of 15, while SEARCH and REPLACE — whose runs sit either side of a
    // word — come through intact. Recognition matches the runs by shape, so a
    // miscounted rule still yields an applyable patch.
    const DRIFTED_SEPARATOR = `╠${'═'.repeat(19)}╣`;

    test('recovers a block whose separator has the wrong number of ═', async function (assert) {
      let block = `example-card.json
${SEARCH_MARKER}
{ "old": true }
${DRIFTED_SEPARATOR}
{ "new": true }
${REPLACE_MARKER}`;

      assert.true(
        isCompleteSearchReplaceBlock(block),
        'the block counts as complete',
      );
      let result = parseSearchReplace(block);
      assert.strictEqual(result.searchContent, `{ "old": true }`);
      assert.strictEqual(result.replaceContent, `{ "new": true }`);
    });

    test('recovers a drifted SEARCH or REPLACE marker too', async function (assert) {
      let block = `example-card.json
╔═ SEARCH ═╗
{ "old": true }
${SEPARATOR_MARKER}
{ "new": true }
╚══════ REPLACE ══════╝`;

      assert.true(isCompleteSearchReplaceBlock(block));
      let result = parseSearchReplace(block);
      assert.strictEqual(result.searchContent, `{ "old": true }`);
      assert.strictEqual(result.replaceContent, `{ "new": true }`);
    });

    test('strips a stray trailing separator that has drifted as well', async function (assert) {
      let block = `game-1.json
${SEARCH_MARKER}
{ "old": true }
${SEPARATOR_MARKER}
{ "new": true }
${DRIFTED_SEPARATOR}
${REPLACE_MARKER}`;
      let result = parseSearchReplace(block);
      assert.strictEqual(result.replaceContent, `{ "new": true }`);
    });

    test('does not treat out-of-order markers as a complete block', async function (assert) {
      let block = `game-1.json
${REPLACE_MARKER}
{ "old": true }
${SEPARATOR_MARKER}
{ "new": true }
${SEARCH_MARKER}`;
      assert.false(
        isCompleteSearchReplaceBlock(block),
        'the markers must appear in order',
      );
    });

    test('a block with no separator at all is still incomplete', async function (assert) {
      let block = `game-1.json
${SEARCH_MARKER}
{ "old": true }
${REPLACE_MARKER}`;
      assert.false(isCompleteSearchReplaceBlock(block));
    });
  },
);
