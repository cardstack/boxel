import { module, test } from 'qunit';

import {
  containsSearchReplaceMarker,
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
} from '@cardstack/runtime-common';

import { extractCodeData } from '@cardstack/host/lib/formatted-message/utils';
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

    // A separator is only a run of ═ between two brackets, a shape that can
    // occur inside the code being patched. The marker is written on a line of
    // its own, so requiring that keeps content from being read as the divider.
    test('a divider-shaped run inside content is not the divider', async function (assert) {
      let block = `example-card.json
${SEARCH_MARKER}
let box = '{a ╠═╣ b}';
${SEPARATOR_MARKER}
let box = '{a b}';
${REPLACE_MARKER}`;

      let result = parseSearchReplace(block);
      assert.strictEqual(
        result.searchContent,
        `let box = '{a ╠═╣ b}';`,
        'the inline run stays in the search half',
      );
      assert.strictEqual(result.replaceContent, `let box = '{a b}';`);
    });

    test('a separator indented on its own line is still the divider', async function (assert) {
      let block = `example-card.json
${SEARCH_MARKER}
  let a = 1;
    ${SEPARATOR_MARKER}
  let a = 2;
${REPLACE_MARKER}`;
      let result = parseSearchReplace(block);
      assert.strictEqual(result.searchContent, '  let a = 1;');
      assert.strictEqual(result.replaceContent, '  let a = 2;');
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

    // An answer too long for one event is split at a character count that knows
    // nothing about what it is cutting through, so each half of a straddled
    // block holds only some of the markers.
    test('recognizes a lone marker from either half of a split block', async function (assert) {
      assert.true(
        containsSearchReplaceMarker(`${SEARCH_MARKER}\n{ "old": true }`),
        'the head half',
      );
      assert.true(
        containsSearchReplaceMarker(`{ "new": true }\n${REPLACE_MARKER}`),
        'the tail half',
      );
      assert.true(
        containsSearchReplaceMarker(`{ "x": 1 }\n${DRIFTED_SEPARATOR}`),
        'a drifted separator alone',
      );
      assert.false(
        containsSearchReplaceMarker('const x = 1;'),
        'ordinary code carries no marker',
      );
      assert.false(containsSearchReplaceMarker(''), 'empty body');
    });
  },
);

module('Unit | code patching | malformed patch detection', function () {
  function codeDataFor(preContents: string) {
    return extractCodeData(
      `<pre data-code-language="typescript">${preContents}</pre>`,
      '!room',
      '$event',
      0,
    );
  }

  // `malformedPatch` drives the warning shown once streaming has finished, so
  // it has to separate a patch whose markers came through wrong from content
  // that was never a patch at all.
  test('is true for a block that opens a SEARCH marker but never completes', function (assert) {
    let codeData = codeDataFor(`https://example.com/file.ts
${SEARCH_MARKER}
let a = 1;`);

    assert.true(codeData.malformedPatch);
    assert.strictEqual(codeData.searchReplaceBlock, null);
  });

  test('is false for a well-formed block', function (assert) {
    let codeData = codeDataFor(`https://example.com/file.ts
${SEARCH_MARKER}
let a = 1;
${SEPARATOR_MARKER}
let a = 2;
${REPLACE_MARKER}`);

    assert.false(codeData.malformedPatch);
    assert.notStrictEqual(codeData.searchReplaceBlock, null);
  });

  test('is false for a block whose separator drifted, since that still parses', function (assert) {
    let codeData = codeDataFor(`https://example.com/file.ts
${SEARCH_MARKER}
let a = 1;
╠${'═'.repeat(19)}╣
let a = 2;
${REPLACE_MARKER}`);

    assert.false(codeData.malformedPatch);
  });

  test('is false for ordinary code carrying no marker', function (assert) {
    let codeData = codeDataFor(`let a = 1;
let b = 2;`);

    assert.false(codeData.malformedPatch);
    assert.strictEqual(codeData.fileUrl, null);
  });
});
