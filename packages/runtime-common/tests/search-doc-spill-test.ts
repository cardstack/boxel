import type { SharedTests } from '../helpers/index.ts';
import {
  collectSpillRefs,
  isSpillMarker,
  SEARCH_DOC_INLINE_ARRAY_MAX,
  SEARCH_DOC_INLINE_STRING_MAX,
  spillRef,
  spillSearchDoc,
  unspillSearchDoc,
} from '../search-doc-spill.ts';

const key = { url: 'http://test-realm/test/Talk/1.json', type: 'instance' };
const long = (seed: string) =>
  seed.repeat(Math.ceil((SEARCH_DOC_INLINE_STRING_MAX + 1) / seed.length));
const vector = `vec:[${Array.from({ length: 256 }, (_, i) => i % 127).join(',')}]`;

function bigDoc() {
  return {
    _title: long('a title that is very long '),
    _passages: ['segments'],
    cardTitle: long('a card title '),
    hnScore: 12,
    isDuplicate: false,
    summary: 'short enough to stay',
    text: long('the whole transcript '),
    embedding: vector,
    tags: Array.from(
      { length: SEARCH_DOC_INLINE_ARRAY_MAX + 1 },
      (_, i) => `t${i}`,
    ),
    segments: [
      { start: 0, text: long('first segment '), embedding: vector },
      { start: 60, text: 'a short one', embedding: vector },
      { start: 120, text: long('third segment '), embedding: vector },
    ],
    speaker: { id: 'http://test-realm/test/Person/1', bio: long('a bio ') },
  };
}

const tests = Object.freeze({
  'a doc that fits inline is promoted whole': async (assert) => {
    assert.strictEqual(
      await spillSearchDoc({ text: long('x'), hnScore: 1 }, key),
      undefined,
      'a long string in a small doc stays inline',
    );
    assert.strictEqual(await spillSearchDoc(null, key), undefined);
  },

  'a large doc spills its large values, wherever they are': async (assert) => {
    let original = bigDoc();
    let result = await spillSearchDoc(original, key);
    assert.ok(result, 'the doc spills');
    let { searchDoc, rows } = result!;
    assert.deepEqual(original, bigDoc(), 'the input is not modified');

    assert.strictEqual(searchDoc._title, original._title, 'platform keys stay');
    assert.strictEqual(searchDoc.cardTitle, original.cardTitle, 'titles stay');
    assert.strictEqual(searchDoc.hnScore, 12, 'numbers stay');
    assert.false(searchDoc.isDuplicate, 'booleans stay');
    assert.strictEqual(searchDoc.summary, 'short enough to stay');
    assert.true(isSpillMarker(searchDoc.text), 'a long string spills');
    assert.deepEqual(
      (searchDoc.embedding as { $spilled: string }).$spilled,
      'vector',
      'a vector spills as a vector',
    );
    assert.true(isSpillMarker(searchDoc.tags), 'a long array spills whole');
    let segments = searchDoc.segments as Record<string, unknown>[];
    assert.true(isSpillMarker(segments[0].text));
    assert.strictEqual(segments[1].text, 'a short one');
    assert.true(isSpillMarker(segments[2].text));
    assert.strictEqual(segments[0].start, 0, 'siblings of a spill stay');
    assert.true(
      isSpillMarker((searchDoc.speaker as Record<string, unknown>).bio),
      "a linked card's long value spills into this row",
    );
    assert.true(
      JSON.stringify(searchDoc).length < 2000,
      `the promoted doc fits inline (${JSON.stringify(searchDoc).length} bytes)`,
    );

    assert.deepEqual(
      rows.filter((r) => r.fieldPath === 'segments.text').map((r) => r.ordinal),
      [0, 1],
      'ordinals number the spilled values at a path, in document order',
    );
    assert.deepEqual(
      rows
        .filter((r) => r.fieldPath === 'segments.embedding')
        .map((r) => r.ordinal),
      [0, 1, 2],
    );
    assert.strictEqual(
      rows.find((r) => r.fieldPath === 'text')!.ref,
      await spillRef(key.url, key.type, 'text', 0),
      'a ref is the hash of the row key and the position',
    );
    assert.strictEqual(
      new Set(rows.map((r) => r.ref)).size,
      rows.length,
      'refs are distinct',
    );
  },

  'unspilling restores the original doc': async (assert) => {
    let original = bigDoc();
    let { searchDoc, rows } = (await spillSearchDoc(original, key))!;
    assert.deepEqual(
      collectSpillRefs(searchDoc).sort(),
      rows.map((r) => r.ref).sort(),
      'every marker is found',
    );
    assert.deepEqual(
      unspillSearchDoc(searchDoc, new Map(rows.map((r) => [r.ref, r.value]))),
      original,
    );
    let partial = unspillSearchDoc(searchDoc, new Map());
    assert.true(isSpillMarker(partial.text), 'a missing value stays a marker');
  },

  'the same value gets the same ref every time it is indexed': async (
    assert,
  ) => {
    let first = (await spillSearchDoc(bigDoc(), key))!;
    let second = (await spillSearchDoc(bigDoc(), key))!;
    assert.deepEqual(
      first.rows.map((r) => r.ref),
      second.rows.map((r) => r.ref),
    );
    let other = (await spillSearchDoc(bigDoc(), {
      ...key,
      url: 'http://test-realm/test/Talk/2.json',
    }))!;
    assert.notStrictEqual(other.rows[0].ref, first.rows[0].ref);
  },

  'a doc still over the target after its leaves spill sends whole lists':
    async (assert) => {
      let talk = {
        cardTitle: 'a long talk',
        hnScore: 7,
        tags: ['a', 'b'],
        segments: Array.from({ length: 30 }, (_, i) => ({
          start: i * 60,
          end: i * 60 + 60,
          concept: `concept ${i}`,
          text: `segment ${i} says something short`,
          embedding: vector,
        })),
      };
      let { searchDoc, rows } = (await spillSearchDoc(talk, key))!;
      assert.true(isSpillMarker(searchDoc.segments), 'the list spilled whole');
      assert.deepEqual(searchDoc.tags, ['a', 'b'], 'a small list stays');
      assert.strictEqual(searchDoc.hnScore, 7);
      assert.deepEqual(
        rows.map((r) => r.fieldPath),
        ['segments'],
        'the leaf rows inside the list are gone',
      );
      assert.deepEqual(
        rows[0].value,
        talk.segments,
        'the row holds the original list, with no markers inside',
      );
      assert.true(
        JSON.stringify(searchDoc).length <= 2000,
        `the promoted doc fits (${JSON.stringify(searchDoc).length} bytes)`,
      );
      assert.deepEqual(
        unspillSearchDoc(searchDoc, new Map(rows.map((r) => [r.ref, r.value]))),
        talk,
      );
    },

  'a doc over the target keeps its short lists inline': async (assert) => {
    let talk = {
      cardTitle: 'a long talk',
      concepts: ['ownership-and-borrowing', 'lifetimes'],
      speakers: ['Ada'],
      segments: Array.from({ length: 30 }, (_, i) => ({
        start: i * 60,
        end: i * 60 + 60,
        concept: `concept ${i}`,
        text: `segment ${i} says something short`,
      })),
      // Short lists that together keep the doc over the target after the
      // segments go.
      ...Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          `facet${i}`,
          Array.from(
            { length: 8 },
            (_, j) => `value ${i}-${j} of a short list`,
          ),
        ]),
      ),
    };
    let { searchDoc, rows } = (await spillSearchDoc(talk, key))!;
    assert.true(isSpillMarker(searchDoc.segments), 'the big list spilled');
    assert.deepEqual(
      rows.map((r) => r.fieldPath),
      ['segments'],
      'nothing else spilled',
    );
    assert.deepEqual(searchDoc.concepts, talk.concepts, 'concepts stay');
    assert.deepEqual(searchDoc.speakers, talk.speakers, 'speakers stay');
    assert.deepEqual(searchDoc.facet0, talk.facet0, 'every short list stays');
    assert.true(
      JSON.stringify(searchDoc).length > 2000,
      'the doc stays over the target rather than spill a short list',
    );
    assert.deepEqual(
      unspillSearchDoc(searchDoc, new Map(rows.map((r) => [r.ref, r.value]))),
      talk,
    );
  },

  'a doc made only of short lists is promoted whole': async (assert) => {
    let doc = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `facet${i}`,
        Array.from({ length: 8 }, (_, j) => `value ${i}-${j} of a short list`),
      ]),
    );
    assert.true(
      JSON.stringify(doc).length > 2000,
      'the doc is over the target',
    );
    assert.strictEqual(
      await spillSearchDoc(doc, key),
      undefined,
      'no list is big enough to spill',
    );
  },
} as SharedTests<{}>);

export default tests;
