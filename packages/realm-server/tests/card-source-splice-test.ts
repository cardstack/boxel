import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  stageAppendContainsMany,
  isOperationFailure,
  scanCardSource,
  MalformedCardSourceError,
  type AppendContainsManyEntry,
  type SourceBytes,
  type StagingContext,
} from '@cardstack/runtime-common/card-operations';
import {
  RealmPaths,
  maybeRelativeReference,
  rri,
  splice,
  streamSpliced,
  wholeFile,
  type CodeRef,
  type SplicedSource,
} from '@cardstack/runtime-common';
import type { Definition } from '@cardstack/runtime-common/definitions';

// ============================================================================
// Reading a stored card's JSON for the offsets an append writes at, and
// describing the result without holding it.
//
// Two properties are under test and neither is visible from the outside of a
// realm. The bytes: a splice has to produce what loading the file, changing it
// and writing it back would have produced, whatever the file's own formatting
// — otherwise the two ways of changing a card are not interchangeable. And the
// cost: what makes this behavior worth having is that appending one item to a
// card holding a hundred thousand of them costs one item, so the last case
// here appends to exactly that and watches the heap while it does.
// ============================================================================

const REALM = 'http://example.com/test/';
const LOG = { module: rri(`${REALM}event-log`), name: 'EventLog' };
const EVENT = { module: rri(`${REALM}event-log`), name: 'LogEvent' };
const PERSON = { module: rri(`${REALM}person`), name: 'Person' };
const STRING = { module: rri(`${REALM}string`), name: 'default' };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function logDefinition(): Definition {
  return {
    type: 'card-def',
    codeRef: LOG,
    displayName: 'Event Log',
    fields: { events: 'f0' },
    fieldDefs: {
      f0: {
        type: 'containsMany',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: EVENT,
      },
    },
  } as Definition;
}

function eventDefinition(): Definition {
  return {
    type: 'field-def',
    codeRef: EVENT,
    displayName: null,
    fields: { label: 'f0', author: 'f1' },
    fieldDefs: {
      f0: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: STRING,
      },
      f1: {
        type: 'linksTo',
        isPrimitive: false,
        isComputed: false,
        fieldOrCard: PERSON,
      },
    },
  } as Definition;
}

// A staging context over one file, whose bytes are produced by `bytes` rather
// than held. Everything an append does not reach is left to fail loudly if it
// ever is.
function context(bytes: SourceBytes): StagingContext {
  let definitions: Record<string, Definition> = {
    EventLog: logDefinition(),
    LogEvent: eventDefinition(),
  };
  return {
    realmURL: REALM,
    paths: new RealmPaths(new URL(REALM)),
    lids: new Map(),
    foreignLids: new Set(),
    stored: new Map(),
    splices: new Map(),
    actor: '@tester:localhost',
    async openSourceBytes() {
      return bytes;
    },
    async lookupDefinition(codeRef: CodeRef) {
      return 'name' in codeRef ? definitions[codeRef.name] : undefined;
    },
    serializeCard() {
      throw new Error('an append serializes no document');
    },
    codeRefKey() {
      throw new Error('an append compares no code refs');
    },
    resolveModuleId() {
      throw new Error('an append resolves no module ids');
    },
    storedLink(selfLink: string, relativeTo: URL) {
      return maybeRelativeReference(
        new URL(selfLink),
        relativeTo,
        new URL(REALM),
      );
    },
  } as unknown as StagingContext;
}

// The bytes of a string, handed out in fixed-size pieces. A scan that assumed
// a piece was a whole token would be found out by the one-byte size the cases
// below use.
function chunkedBytes(text: string, chunk = 1): SourceBytes {
  let bytes = encoder.encode(text);
  return {
    size: bytes.length,
    async *read(start: number, end: number) {
      for (let at = start; at < end; at += chunk) {
        yield bytes.subarray(at, Math.min(at + chunk, end));
      }
    },
  };
}

async function* chunked(text: string, size = 1): AsyncIterable<Uint8Array> {
  let bytes = encoder.encode(text);
  for (let at = 0; at < bytes.length; at += size) {
    yield bytes.subarray(at, Math.min(at + size, bytes.length));
  }
}

async function materialize(
  content: SplicedSource,
  source: SourceBytes,
): Promise<string> {
  let chunks: Uint8Array[] = [];
  for await (let chunk of streamSpliced(content, (start, end) =>
    source.read(start, end),
  )) {
    chunks.push(chunk);
  }
  let bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (let chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return decoder.decode(bytes);
}

// Stage an append against `stored` and return the bytes it describes.
async function appended(
  stored: string,
  entry: Omit<AppendContainsManyEntry, 'op' | 'href'>,
  chunk = 1,
): Promise<string> {
  let bytes = chunkedBytes(stored, chunk);
  let change = await stageAppendContainsMany(
    { op: 'appendContainsMany', href: `${REALM}log-1`, ...entry },
    context(bytes),
  );
  let content = change.writes[0].content as SplicedSource;
  let text = await materialize(content, bytes);
  if (content.size !== encoder.encode(text).length) {
    throw new Error(
      `the described size (${content.size}) is not the size of what it ` +
        `describes (${encoder.encode(text).length})`,
    );
  }
  return text;
}

function logFile(events: unknown[], indent: string | number = 2): string {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes: { events },
        meta: { adoptsFrom: LOG },
      },
    },
    null,
    indent,
  );
}

module(basename(import.meta.filename), function () {
  test('a document is read the same whatever the bytes arrive in', async function (assert) {
    let stored = logFile([{ label: 'first' }, { label: 'second' }]);
    for (let chunk of [1, 3, 64, stored.length]) {
      let layout = await scanCardSource(chunked(stored, chunk), ['events']);
      let events = layout.arrays.get('events');
      assert.strictEqual(
        events?.count,
        2,
        `the array's members are counted at a chunk size of ${chunk}`,
      );
      assert.strictEqual(
        stored.slice(events!.closeAt, events!.closeAt + 1),
        ']',
        `the closing bracket is where the scan says at a chunk size of ${chunk}`,
      );
      assert.deepEqual(
        layout.adoptsFrom,
        LOG,
        `the card's type is read at a chunk size of ${chunk}`,
      );
    }
  });

  test("an append reuses the file's own indentation", async function (assert) {
    for (let indent of [2, 4, '\t']) {
      let stored = logFile([{ label: 'first' }], indent);
      assert.strictEqual(
        await appended(stored, {
          field: 'events',
          items: [{ label: 'second' }],
        }),
        JSON.stringify(
          {
            data: {
              type: 'card',
              attributes: {
                events: [{ label: 'first' }, { label: 'second' }],
              },
              meta: { adoptsFrom: LOG },
            },
          },
          null,
          indent,
        ),
        `a file indented with ${JSON.stringify(indent)} stays indented that way`,
      );
    }
  });

  test('a value whose bytes are not its characters is spliced at the right offset', async function (assert) {
    // Every offset the scan reports is a byte offset, and the label below
    // takes more bytes than it has characters — so a scan that counted
    // characters would splice in the middle of one of them.
    let stored = logFile([{ label: 'héllo → ✓' }]);
    assert.strictEqual(
      await appended(stored, {
        field: 'events',
        items: [{ label: 'ünïcode' }],
      }),
      logFile([{ label: 'héllo → ✓' }, { label: 'ünïcode' }]),
      'the result is the document with the item appended',
    );
  });

  test('an array the file does not carry is created', async function (assert) {
    let stored = JSON.stringify(
      { data: { type: 'card', attributes: {}, meta: { adoptsFrom: LOG } } },
      null,
      2,
    );
    assert.strictEqual(
      await appended(stored, { field: 'events', items: [{ label: 'first' }] }),
      JSON.stringify(
        {
          data: {
            type: 'card',
            attributes: { events: [{ label: 'first' }] },
            meta: { adoptsFrom: LOG },
          },
        },
        null,
        2,
      ),
      'the field is written into the attributes the file already carries',
    );
  });

  test('attributes the file does not carry are created', async function (assert) {
    let stored = JSON.stringify(
      { data: { type: 'card', meta: { adoptsFrom: LOG } } },
      null,
      2,
    );
    assert.strictEqual(
      await appended(stored, { field: 'events', items: [{ label: 'first' }] }),
      JSON.stringify(
        {
          data: {
            type: 'card',
            meta: { adoptsFrom: LOG },
            attributes: { events: [{ label: 'first' }] },
          },
        },
        null,
        2,
      ),
      'the container is created where an in-memory change would have put it',
    );
  });

  test('a document that ends part-way through is refused', async function (assert) {
    let truncated = logFile([{ label: 'first' }]).slice(0, 40);
    try {
      await scanCardSource(chunked(truncated), ['events']);
      assert.ok(false, 'the scan should not have finished');
    } catch (err: unknown) {
      assert.ok(
        err instanceof MalformedCardSourceError,
        'the scan says the document is malformed rather than reporting ' +
          'offsets read from half of one',
      );
    }
  });

  test('a brace inside a string is not a container', async function (assert) {
    // A scanner that counted brackets without tracking strings would take the
    // label below for structure and report the array as ending somewhere
    // inside it.
    let stored = logFile([{ label: '}] not structure [{ "events": [' }]);
    assert.strictEqual(
      await appended(stored, { field: 'events', items: [{ label: 'second' }] }),
      logFile([
        { label: '}] not structure [{ "events": [' },
        { label: 'second' },
      ]),
      'the array ends where the document says, not where its contents do',
    );
  });

  test('an escaped quote does not end the string it is in', async function (assert) {
    let stored = logFile([{ label: 'a \\" b \\\\' }]);
    assert.strictEqual(
      await appended(stored, { field: 'events', items: [{ label: 'second' }] }),
      logFile([{ label: 'a \\" b \\\\' }, { label: 'second' }]),
      'the string ends at its own closing quote',
    );
  });

  test('a file written without whitespace is appended to without any', async function (assert) {
    // The realm does not always store a card pretty-printed, so an insertion
    // reads the style out of the document rather than assuming one.
    let stored = JSON.stringify({
      data: {
        type: 'card',
        attributes: { events: [] },
        meta: { adoptsFrom: LOG },
      },
    });
    assert.strictEqual(
      await appended(stored, { field: 'events', items: [{ label: 'first' }] }),
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { events: [{ label: 'first' }] },
          meta: { adoptsFrom: LOG },
        },
      }),
      'the file stays compact rather than gaining a pretty-printed member',
    );
  });

  test('an empty container is indented the way the rest of the file is', async function (assert) {
    // An empty array carries no indentation of its own, so the style comes
    // from the document — the case a container with members reads off itself.
    for (let indent of [4, '\t']) {
      let stored = logFile([], indent);
      assert.strictEqual(
        await appended(stored, {
          field: 'events',
          items: [{ label: 'first' }],
        }),
        logFile([{ label: 'first' }], indent),
        `an empty array in a file indented with ${JSON.stringify(indent)} ` +
          `is filled at that indentation`,
      );
    }
  });

  test('a stored container that names positions rather than members is refused', async function (assert) {
    // Object-member text written into an array leaves a file that no longer
    // parses, so the kind is checked before anything is spliced.
    for (let container of ['attributes', 'relationships', 'meta']) {
      let doc: Record<string, unknown> = {
        type: 'card',
        attributes: { events: [] },
        meta: { adoptsFrom: LOG },
      };
      doc[container] = [];
      let stored = JSON.stringify({ data: doc }, null, 2);
      let failure: unknown;
      try {
        await appended(stored, {
          field: 'events',
          items: [{ label: 'first' }],
        });
      } catch (err: unknown) {
        failure = err;
      }
      assert.strictEqual(
        isOperationFailure(failure) ? failure.error.status : undefined,
        500,
        `an array under \`data.${container}\` is refused rather than ` +
          `written into`,
      );
    }
  });

  test('a key spelled with the escape form of an astral character decodes to it', async function (assert) {
    // A surrogate pair is one character written as two escapes, and either
    // half alone names nothing — so the pair is decoded together.
    let stored = JSON.stringify(
      {
        data: {
          type: 'card',
          attributes: { '\u{1F600}': [], events: [] },
          meta: { adoptsFrom: LOG },
        },
      },
      null,
      2,
    ).replace('😀', '\\ud83d\\ude00');
    let layout = await scanCardSource(chunked(stored), ['😀']);
    assert.ok(
      layout.attributeKeys.has('😀'),
      'the key reads back as the character it spells, not as two ' +
        'replacement characters',
    );
  });

  test('a description splices into a description', async function (assert) {
    let bytes = chunkedBytes('0123456789');
    let once = splice(wholeFile('x.json', bytes.size), [
      { at: 5, text: 'AAA' },
    ]);
    let twice = splice(once, [
      { at: 0, text: '<' },
      { at: 7, text: '-' },
      { at: 13, text: '>' },
    ]);
    assert.strictEqual(
      await materialize(twice, bytes),
      '<01234AA-A56789>',
      'the second round addresses what the first produced, text runs included',
    );
    assert.strictEqual(twice.size, 16, 'and the size is arithmetic over both');
  });

  test('appending to a hundred thousand items costs one item', async function (assert) {
    const BLOCK = 1_000;
    const BLOCKS = 300;
    const ITEMS = BLOCK * BLOCKS + 1;
    // The document is produced as it is read rather than held: one block of
    // items, encoded once and handed out again, in pieces the size a file
    // stream hands out. So the fixture allocates nothing per item and the
    // measurement below is of the append rather than of the test. The size is
    // known the way the realm knows a file's — from what a stat reports, not
    // from reading it.
    let item = `\n        {\n          "label": "event"\n        }`;
    let head = encoder.encode(
      `{\n  "data": {\n    "type": "card",\n    "attributes": {\n      "events": [` +
        item,
    );
    let block = encoder.encode(`,${item}`.repeat(BLOCK));
    let tail = encoder.encode(
      `\n      ]\n    },\n    "meta": {\n      "adoptsFrom": {\n` +
        `        "module": "${LOG.module}",\n        "name": "${LOG.name}"\n` +
        `      }\n    }\n  }\n}`,
    );
    let size = head.length + block.length * BLOCKS + tail.length;

    let source: SourceBytes = {
      size,
      async *read(start: number, end: number) {
        let at = 0;
        let emit = function* (bytes: Uint8Array) {
          let from = Math.max(start - at, 0);
          let to = Math.min(end - at, bytes.length);
          at += bytes.length;
          if (to > from) {
            yield from === 0 && to === bytes.length
              ? bytes
              : bytes.subarray(from, to);
          }
        };
        yield* emit(head);
        for (let index = 0; index < BLOCKS && at < end; index++) {
          yield* emit(block);
        }
        yield* emit(tail);
      },
    };

    // A heap reading taken without collecting first counts garbage as well as
    // what is held, and an append of this size allocates plenty of the former
    // — so the reading below only means "retained" if a collection runs on
    // both sides of it. The runner is expected to expose one; without it the
    // measurement measures the wrong thing, which is worth failing over rather
    // than passing quietly.
    let collect = (globalThis as { gc?: () => void }).gc;
    assert.strictEqual(
      typeof collect,
      'function',
      'the test runner exposes a collector, without which a heap reading ' +
        'cannot tell what is held from what is merely uncollected',
    );
    collect?.();
    let before = process.memoryUsage().heapUsed;
    let change = await stageAppendContainsMany(
      {
        op: 'appendContainsMany',
        href: `${REALM}log-1`,
        field: 'events',
        items: [{ label: 'the last one', author: `${REALM}Person/mango` }],
      },
      context(source),
    );
    collect?.();
    let growth = process.memoryUsage().heapUsed - before;

    let content = change.writes[0].content as SplicedSource;
    assert.strictEqual(
      content.size - size,
      encoder.encode(
        `,\n        {\n          "label": "the last one"\n        }` +
          `,\n    "relationships": {\n      "events.${ITEMS}.author": {\n` +
          `        "links": {\n          "self": "./Person/mango"\n` +
          `        }\n      }\n    }`,
      ).length,
      'the file grows by the item and its link and nothing else',
    );
    assert.strictEqual(
      content.segments.filter((segment) => segment.kind === 'text').length,
      2,
      'which is described as two runs of new text over the file it edits, ' +
        'however many items that file holds',
    );
    // A document this size cannot be held for less than its own length, so a
    // bound well under it is a bound that no implementation holding the array
    // could meet.
    assert.ok(
      growth < size / 4,
      `staging the append held ${Math.round(growth / 1024)}KB, which does not ` +
        `scale with the ${ITEMS} items already stored (the document itself is ` +
        `${Math.round(size / 1024 / 1024)}MB)`,
    );
  });
});
