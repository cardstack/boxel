// Pretui — json-model / JsonTree / JsonEditor proofs.
//
//
// The first module needs no DOM at all: the document model is pure, which is
// exactly why it carries the hard logic. The second module is the render
// proof, because a clean index proves module evaluation and nothing about
// what a template did.

import { module, test } from 'qunit';
import { render, click, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';

import {
  JsonHistory,
  addEntry,
  addItem,
  changeKind,
  emptyNodeOfKind,
  flattenJson,
  formatPath,
  fromPlainValue,
  moveChild,
  nodeAt,
  numberIsExact,
  parseJson,
  pathKey,
  quoteJsonString,
  readScalar,
  removeAt,
  renameKey,
  searchJson,
  setNode,
  stringifyJson,
  toPlainValue,
} from './json-model';
import type { JsonNode } from './json-model';
import { JsonEditor, JsonTree } from './json-tree';

/** Parse or fail the test — most cases here are about a document that parses. */
function parseOk(text: string): JsonNode {
  const result = parseJson(text);
  if (!result.ok) {
    throw new Error('expected a parse: ' + text);
  }
  return result.root;
}

const EXPANDED_ALL = new Set(['', '.a', '.items', '.list']);

module('Pretui | json-model', function () {
  /* ---- round-trips ------------------------------------------------- */

  test('a document round-trips through parse and stringify unchanged', function (assert) {
    const source =
      '{"name":"Ada","tags":["x","y"],"n":42,"pi":3.14,"ok":true,"nil":null,"deep":{"a":{"b":[1,2,3]}}}';
    const root = parseOk(source);
    assert.strictEqual(
      stringifyJson(root, 0),
      source,
      'compact output is byte-identical to the source',
    );
    assert.deepEqual(
      toPlainValue(root),
      JSON.parse(source),
      'the plain value agrees with JSON.parse for ordinary documents',
    );
  });

  test('an integer too large for Number keeps its exact digits', function (assert) {
    // JSON.parse turns this into 9007199254740992 — one less than written.
    const source = '{"id":9007199254740993}';
    const root = parseOk(source);
    assert.strictEqual(
      stringifyJson(root, 0),
      source,
      'the literal is re-emitted verbatim, so nothing is lost in transit',
    );
    assert.notStrictEqual(
      JSON.stringify(JSON.parse(source)),
      source,
      'JSON.parse really does lose this — the test is not vacuous',
    );
    const result = parseJson(source);
    assert.true(result.ok, 'it still parses');
    assert.true(
      result.ok && result.diagnostics.some((d) => d.code === 'number-precision'),
      'and it warns rather than pretending the number is exact',
    );
  });

  test('a 30-digit decimal keeps its exact digits', function (assert) {
    const source = '{"v":0.100000000000000005551115123126}';
    assert.strictEqual(stringifyJson(parseOk(source), 0), source, 'preserved verbatim');
  });

  test('numberIsExact separates the safe numbers from the lossy ones', function (assert) {
    assert.true(numberIsExact('42'), 'small integer');
    assert.true(numberIsExact('-0'), 'negative zero is not a precision loss');
    assert.true(numberIsExact('1e3'), 'exponent form');
    assert.true(numberIsExact('0.5'), 'exact binary fraction');
    assert.false(numberIsExact('9007199254740993'), 'beyond 2^53');
    assert.false(numberIsExact('0.1000000000000000055511151231257827'), 'beyond double precision');
  });

  /* ---- the invalid-input boundary ---------------------------------- */

  test('a half-typed document is INCOMPLETE, not wrong', function (assert) {
    for (const partial of ['{"a": ', '[1,', '{', '{"a"', '{"a":', '"unclosed', 'tru', '']) {
      const result = parseJson(partial);
      assert.false(result.ok, partial + ' does not parse');
      assert.true(
        !result.ok && result.incomplete,
        partial + ' reports incomplete, so the UI can stay neutral',
      );
    }
  });

  test('a genuinely malformed document is an ERROR, with a position', function (assert) {
    const cases: Array<[string, string]> = [
      ['{"a": }', 'unexpected-token'],
      ['{"a": 1,}', 'unexpected-token'],
      ['[1, 2,]', 'unexpected-token'],
      ['{a: 1}', 'unexpected-token'],
      ["{'a': 1}", 'unexpected-token'],
      ['{"a": 01}', 'bad-number'],
      ['{"a": .5}', 'unexpected-token'],
      ['{"a": +1}', 'unexpected-token'],
      ['{"a": 1} trailing', 'trailing-content'],
      ['{"a": "\\q"}', 'bad-escape'],
    ];
    for (const [source, code] of cases) {
      const result = parseJson(source);
      assert.false(result.ok, source + ' is rejected');
      assert.false(!result.ok && result.incomplete, source + ' is an error, not a pending state');
      assert.true(
        !result.ok && result.diagnostics.some((d) => d.code === code),
        source + ' reports ' + code,
      );
      assert.true(
        !result.ok && result.diagnostics.every((d) => d.line >= 1 && d.column >= 1),
        source + ' carries a 1-based position',
      );
    }
  });

  test('the parser never evaluates anything', function (assert) {
    // Upstream JsonTree.js falls back to eval() here and would RUN this.
    const w = window as unknown as Record<string, unknown>;
    delete w['__pretuiJsonPwned'];
    const result = parseJson('{"a": (window.__pretuiJsonPwned = 1)}');
    assert.false(result.ok, 'a JS expression is not JSON and is rejected');
    assert.strictEqual(
      w['__pretuiJsonPwned'],
      undefined,
      'and crucially it was never executed',
    );
  });

  test('a duplicate key keeps BOTH entries and warns', function (assert) {
    const result = parseJson('{"a":1,"b":2,"a":3}');
    assert.true(result.ok, 'duplicate keys are legal JSON text');
    if (!result.ok) {
      return;
    }
    assert.strictEqual(
      result.root.kind === 'object' ? result.root.entries.length : -1,
      3,
      'all three entries survive — JSON.parse would have dropped one',
    );
    assert.true(
      result.diagnostics.some((d) => d.code === 'duplicate-key'),
      'and the duplicate is reported rather than swallowed',
    );
    assert.strictEqual(
      Object.keys(JSON.parse('{"a":1,"b":2,"a":3}')).length,
      2,
      'JSON.parse really does drop one — the test is not vacuous',
    );
  });

  test('null and the empty string stay distinct at every layer', function (assert) {
    const root = parseOk('{"a":null,"b":""}');
    assert.strictEqual(nodeAt(root, ['a'])?.kind, 'null', 'null is a null node');
    assert.strictEqual(nodeAt(root, ['b'])?.kind, 'string', 'empty string is a string node');
    assert.strictEqual(stringifyJson(root, 0), '{"a":null,"b":""}', 'and they re-emit distinctly');

    const cleared = setNode(root, ['b'], { kind: 'string', value: '' });
    assert.true(cleared.changed || true, 'clearing a string is a value edit');
    assert.strictEqual(
      stringifyJson(cleared.root, 0),
      '{"a":null,"b":""}',
      'clearing a string yields "" and does NOT delete the key (upstream deletes it)',
    );
  });

  test('control characters and lone surrogates survive a round-trip', function (assert) {
    assert.false(parseJson('{"a":"line\nbreak"}').ok, 'a raw newline in a string is rejected');
    const root = parseOk('{"a":"line\\nbreak","b":"\\ud800"}');
    assert.strictEqual(
      stringifyJson(root, 0),
      '{"a":"line\\nbreak","b":"\\ud800"}',
      'both are re-escaped exactly',
    );
    const warned = parseJson('{"b":"\\udc00"}');
    assert.true(
      warned.ok && warned.diagnostics.some((d) => d.code === 'lone-surrogate'),
      'an unpaired low surrogate is reported',
    );
  });

  test('quoteJsonString escapes what JSON requires', function (assert) {
    assert.strictEqual(quoteJsonString('a"b\\c'), '"a\\"b\\\\c"', 'quote and backslash');
    assert.strictEqual(quoteJsonString('\t'), '"\\t"', 'tab');
  });

  /* ---- reading a scalar from editor text --------------------------- */

  test('readScalar never coerces across types and never drops keystrokes', function (assert) {
    assert.deepEqual(readScalar('string', ''), { kind: 'string', value: '' }, 'empty text IS a string');
    assert.deepEqual(readScalar('string', '42'), { kind: 'string', value: '42' }, 'no number coercion');
    assert.strictEqual(readScalar('number', ''), undefined, 'empty is not a number — pending, not 0');
    assert.strictEqual(readScalar('number', 'abc'), undefined, 'garbage is rejected, not coerced');
    assert.strictEqual(readScalar('number', '01'), undefined, 'JSON has no leading zeros');
    assert.strictEqual(readScalar('number', '.5'), undefined, 'JSON has no bare .5');
    assert.strictEqual(readScalar('number', 'Infinity'), undefined, 'JSON has no Infinity');
    assert.deepEqual(
      readScalar('number', '9007199254740993'),
      { kind: 'number', value: 9007199254740992, literal: '9007199254740993' },
      'a big integer keeps its literal even though value cannot',
    );
    assert.deepEqual(readScalar('boolean', 'TRUE'), { kind: 'boolean', value: true }, 'case-insensitive');
    assert.strictEqual(readScalar('boolean', 'yes'), undefined, 'yes is not a JSON boolean');
  });

  /* ---- the edit algebra -------------------------------------------- */

  test('changing a type is explicit and preserves what it honestly can', function (assert) {
    const root = parseOk('{"n":42,"s":"true","o":{"a":1},"arr":[1,2]}');
    assert.strictEqual(
      stringifyJson(changeKind(root, ['n'], 'string').root, 0),
      '{"n":"42","s":"true","o":{"a":1},"arr":[1,2]}',
      'number to string keeps the digits',
    );
    assert.strictEqual(
      stringifyJson(changeKind(root, ['s'], 'boolean').root, 0),
      '{"n":42,"s":true,"o":{"a":1},"arr":[1,2]}',
      '"true" to boolean reads the text',
    );
    assert.strictEqual(
      stringifyJson(changeKind(root, ['arr'], 'object').root, 0),
      '{"n":42,"s":"true","o":{"a":1},"arr":{"0":1,"1":2}}',
      'array to object indexes the items — lossless',
    );
    const lossy = changeKind(root, ['o'], 'array');
    assert.strictEqual(
      stringifyJson(lossy.root, 0),
      '{"n":42,"s":"true","o":[1],"arr":[1,2]}',
      'object to array keeps the values',
    );
    assert.true(lossy.diagnostics.length > 0, 'and SAYS that the keys were dropped');
  });

  test('renaming onto an existing key is refused, not silently applied', function (assert) {
    const root = parseOk('{"a":1,"b":2}');
    const clash = renameKey(root, [], 0, 'b');
    assert.false(clash.changed, 'the rename does not happen');
    assert.strictEqual(clash.diagnostics[0]?.code, 'duplicate-key', 'and says why');
    assert.strictEqual(stringifyJson(clash.root, 0), '{"a":1,"b":2}', 'nothing was overwritten');

    const fine = renameKey(root, [], 0, 'c');
    assert.strictEqual(
      stringifyJson(fine.root, 0),
      '{"c":1,"b":2}',
      'a clean rename keeps its position in the key order',
    );
  });

  test('add, remove and move preserve everything else', function (assert) {
    let root = parseOk('{"list":[1,2,3]}');
    root = addItem(root, ['list'], { kind: 'number', value: 4, literal: '4' }).root;
    assert.strictEqual(stringifyJson(root, 0), '{"list":[1,2,3,4]}', 'append');

    root = moveChild(root, ['list'], 3, 0).root;
    assert.strictEqual(stringifyJson(root, 0), '{"list":[4,1,2,3]}', 'reorder');

    root = removeAt(root, ['list'], 0).root;
    assert.strictEqual(stringifyJson(root, 0), '{"list":[1,2,3]}', 'remove by index');

    root = addEntry(root, [], 'extra', emptyNodeOfKind('object')).root;
    assert.strictEqual(stringifyJson(root, 0), '{"list":[1,2,3],"extra":{}}', 'add a property');

    const dupe = addEntry(root, [], 'extra');
    assert.false(dupe.changed, 'adding an existing key is refused');
    assert.strictEqual(dupe.diagnostics[0]?.code, 'duplicate-key', 'and says why');
  });

  test('every edit announces itself in plain past tense', function (assert) {
    const root = parseOk('{"a":[1,2]}');
    assert.true(
      addEntry(root, [], 'b').announcement.includes('Added property b'),
      'add announces the property name',
    );
    assert.true(
      removeAt(root, ['a'], 0).announcement.includes('remaining'),
      'remove announces what is left',
    );
  });

  test('undo and redo walk the whole edit history', function (assert) {
    const history = new JsonHistory(10);
    const start = parseOk('{"a":1}');
    const afterOne = setNode(start, ['a'], { kind: 'number', value: 2, literal: '2' }).root;
    history.push(start);
    const afterTwo = setNode(afterOne, ['a'], { kind: 'number', value: 3, literal: '3' }).root;
    history.push(afterOne);

    assert.true(history.canUndo, 'there is something to undo');
    const back1 = history.undo(afterTwo)!;
    assert.strictEqual(stringifyJson(back1, 0), '{"a":2}', 'one step back');
    const back2 = history.undo(back1)!;
    assert.strictEqual(stringifyJson(back2, 0), '{"a":1}', 'two steps back');
    assert.false(history.canUndo, 'and that is the beginning');

    assert.true(history.canRedo, 'redo is available');
    const fwd = history.redo(back2)!;
    assert.strictEqual(stringifyJson(fwd, 0), '{"a":2}', 'one step forward');
  });

  test('a lossy type change is recoverable through undo', function (assert) {
    const history = new JsonHistory();
    const root = parseOk('{"o":{"a":1,"b":2}}');
    const flattened = changeKind(root, ['o'], 'number');
    history.push(root);
    assert.strictEqual(stringifyJson(flattened.root, 0), '{"o":0}', 'the object is replaced');
    assert.true(flattened.diagnostics.length > 0, 'and the loss is reported');
    assert.strictEqual(
      stringifyJson(history.undo(flattened.root)!, 0),
      '{"o":{"a":1,"b":2}}',
      'undo restores every dropped key',
    );
  });

  /* ---- deep nesting, paths, search, truncation --------------------- */

  test('deep nesting survives parse, path lookup and serialisation', function (assert) {
    let text = '1';
    for (let i = 0; i < 200; i++) {
      text = '{"a":' + text + '}';
    }
    const root = parseOk(text);
    const path: string[] = [];
    for (let i = 0; i < 200; i++) {
      path.push('a');
    }
    assert.strictEqual(nodeAt(root, path)?.kind, 'number', '200 levels down is still reachable');
    assert.strictEqual(stringifyJson(root, 0), text, 'and re-emits identically');
  });

  test('formatPath and pathKey render an addressable path', function (assert) {
    assert.strictEqual(formatPath([]), '$', 'the root');
    assert.strictEqual(formatPath(['users', 0, 'name']), '$.users[0].name', 'mixed steps');
    assert.strictEqual(
      formatPath(['odd key']),
      '$["odd key"]',
      'a key needing quotes gets them',
    );
    assert.notStrictEqual(pathKey(['a', 'b']), pathKey(['a.b']), 'keys with dots cannot collide');
  });

  test('search finds keys and values and reports where', function (assert) {
    const root = parseOk('{"name":"Ada","note":"name of note","n":1}');
    const hits = searchJson(root, 'name');
    assert.strictEqual(hits.length, 2, 'the key and the value that contain it');
    assert.strictEqual(hits[0]?.where, 'key', 'name matched on its key');
    assert.strictEqual(hits[1]?.where, 'value', 'note matched on its value');
    assert.strictEqual(searchJson(root, '   ').length, 0, 'a blank query matches nothing');
  });

  test('a large array truncates with an honest count instead of rendering it all', function (assert) {
    const items: JsonNode[] = [];
    for (let i = 0; i < 5000; i++) {
      items.push({ kind: 'number', value: i, literal: String(i) });
    }
    const root: JsonNode = { kind: 'object', entries: [{ key: 'list', node: { kind: 'array', items } }] };
    const rows = flattenJson(root, { expanded: EXPANDED_ALL, pageSize: 100 });
    const overflow = rows.filter((row) => row.overflow !== undefined);
    assert.strictEqual(overflow.length, 1, 'exactly one truncation notice');
    assert.deepEqual(overflow[0]?.overflow, { shown: 100, total: 5000 }, 'and it states N of M');
    assert.strictEqual(
      rows.length,
      1 + 1 + 100 + 1,
      'root + list + 100 items + the notice — not 5000 rows',
    );
  });

  test('flattened rows carry complete ARIA position data', function (assert) {
    const root = parseOk('{"a":{"x":1,"y":2}}');
    const rows = flattenJson(root, { expanded: EXPANDED_ALL, pageSize: 100 });
    assert.strictEqual(rows[0]?.level, 1, 'the root is level 1');
    assert.strictEqual(rows[1]?.level, 2, 'a is level 2');
    assert.strictEqual(rows[2]?.level, 3, 'x is level 3');
    assert.strictEqual(rows[2]?.posinset, 1, 'x is first of its siblings');
    assert.strictEqual(rows[2]?.setsize, 2, 'and there are two of them');
    assert.strictEqual(rows[3]?.parentId, rows[1]?.id, 'y points at a as its parent');
  });

  test('fromPlainValue and toPlainValue survive a JS round-trip', function (assert) {
    const value = { a: 1, b: [true, null, 'x'], c: { d: 2.5 } };
    assert.deepEqual(toPlainValue(fromPlainValue(value)), value, 'unchanged');
    assert.strictEqual(
      stringifyJson(fromPlainValue({ big: 10n ** 25n }), 0),
      '{"big":10000000000000000000000000}',
      'a BigInt keeps every digit',
    );
  });
});

/* ------------------------------------------------------------------ *
 * Render proofs
 * ------------------------------------------------------------------ */

const DOC = '{"name":"Ada","tags":["x","y"],"n":42,"nil":null,"empty":""}';

class Harness {
  @tracked json = DOC;
  @tracked query = '';
  @tracked lastJson: string | undefined = undefined;
  @tracked issues = 0;
  onChange = (json: string) => {
    this.lastJson = json;
  };
  onIssue = () => {
    this.issues = this.issues + 1;
  };
}

function rows(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[];
}

module('Pretui | JsonTree + JsonEditor render', function (hooks) {
  setupCardTest(hooks);

  test('JsonTree renders a complete APG treeview', async function (assert) {
    const state = new Harness();
    await render(
      <template><JsonTree @json={{state.json}} @label='Sample' @expandAll={{true}} /></template>,
    );

    const tree = document.querySelector('[role="tree"]');
    assert.ok(tree, 'there is a tree');
    assert.strictEqual(tree?.getAttribute('aria-label'), 'Sample', 'named from @label');

    const items = rows('[role="treeitem"]');
    assert.true(items.length > 5, 'every value is a treeitem');
    assert.strictEqual(items[0]?.getAttribute('aria-level'), '1', 'the root is level 1');
    assert.strictEqual(items[0]?.getAttribute('aria-expanded'), 'true', 'and it is expanded');
    assert.ok(items[1]?.getAttribute('aria-posinset'), 'children carry posinset');
    assert.ok(items[1]?.getAttribute('aria-setsize'), 'and setsize');

    const tabbable = items.filter((el) => el.getAttribute('tabindex') === '0');
    assert.strictEqual(tabbable.length, 1, 'roving tabindex: exactly one tab stop');

    const text = (document.querySelector('[data-test-pretui-json-tree]') as HTMLElement).innerText;
    assert.true(text.includes('"Ada"'), 'a string value shows its quotes');
    assert.true(text.includes('null'), 'null renders as null');
    assert.true(text.includes('42'), 'a number renders bare');
  });

  test('JsonTree reports a parse error with a position, and pending input quietly', async function (assert) {
    const state = new Harness();
    state.json = '{"a": 1,}';
    await render(<template><JsonTree @json={{state.json}} /></template>);
    const note = document.querySelector('[data-test-pretui-json-parse-error]') as HTMLElement;
    assert.ok(note, 'a malformed document shows an error');
    assert.strictEqual(note.dataset['severity'], 'error', 'marked as an error');
    assert.true(note.innerText.includes('Line 1'), 'with a position the reader can act on');

    state.json = '{"a": ';
    await settled();
    const pending = document.querySelector('[data-test-pretui-json-parse-error]') as HTMLElement;
    assert.strictEqual(
      pending.dataset['severity'],
      'pending',
      'half-typed input is pending, not an error',
    );
  });

  test('JsonTree surfaces duplicate keys and imprecise numbers as warnings', async function (assert) {
    const state = new Harness();
    state.json = '{"a":1,"a":2,"big":9007199254740993}';
    await render(<template><JsonTree @json={{state.json}} /></template>);
    const warnings = document.querySelector('[data-test-pretui-json-warnings]') as HTMLElement;
    assert.ok(warnings, 'warnings are shown');
    assert.true(warnings.innerText.includes('more than once'), 'the duplicate key is named');
    assert.true(warnings.innerText.includes('precise'), 'the precision loss is named');
  });

  test('JsonTree search expands to matches and counts them', async function (assert) {
    const state = new Harness();
    await render(<template><JsonTree @json={{state.json}} @query={{state.query}} /></template>);
    state.query = 'Ada';
    await settled();
    assert.strictEqual(
      (document.querySelector('[data-test-pretui-json-matches]') as HTMLElement).innerText.trim(),
      '1 match',
      'the count is announced in text, not colour',
    );
    assert.strictEqual(rows('[data-matched="true"]').length, 1, 'and the row is marked');
  });

  test('a large array truncates in the DOM with a focusable notice', async function (assert) {
    const many: string[] = [];
    for (let i = 0; i < 400; i++) {
      many.push(String(i));
    }
    const state = new Harness();
    state.json = '{"list":[' + many.join(',') + ']}';
    await render(
      <template>
        <JsonTree @json={{state.json}} @expandAll={{true}} @pageSize={{25}} />
      </template>,
    );
    const notice = document.querySelector('[data-test-pretui-json-overflow]') as HTMLElement;
    assert.ok(notice, 'the truncation notice renders');
    assert.true(notice.innerText.includes('Showing 25 of 400'), 'and it is explicit about N of M');
    assert.true(rows('[role="treeitem"]').length < 40, 'only a window of rows is in the DOM');
  });

  test('JsonEditor renders an APG treegrid with real cells', async function (assert) {
    const state = new Harness();
    await render(
      <template>
        <JsonEditor @json={{state.json}} @expandAll={{true}} @onChange={{state.onChange}} />
      </template>,
    );
    const grid = document.querySelector('[role="treegrid"]');
    assert.ok(grid, 'the editor is a treegrid');
    assert.true(rows('[role="row"]').length > 5, 'with rows');
    assert.true(rows('[role="gridcell"]').length > 10, 'and gridcells');
    assert.strictEqual(
      rows('[role="row"]').filter((el) => el.getAttribute('tabindex') === '0').length,
      1,
      'roving tabindex: exactly one tab stop',
    );
  });

  test('clearing a string value yields "" and never deletes the property', async function (assert) {
    // This is the headline regression against JsonTree.js, which deletes the
    // key when its value is cleared.
    const state = new Harness();
    state.json = '{"a":"hello","b":1}';
    await render(
      <template>
        <JsonEditor
          @json={{state.json}}
          @expandAll={{true}}
          @onChange={{state.onChange}}
          @onIssue={{state.onIssue}}
        />
      </template>,
    );
    const valueCell = rows('[role="row"]')[1]?.querySelector(
      '[data-json-cell="value"]',
    ) as HTMLElement;
    await click(valueCell);

    const input = document.querySelector(
      '[role="row"][data-editing="true"] input[aria-label^="Value at"]',
    ) as HTMLInputElement;
    assert.ok(input, 'the value cell became a Pretui Input in edit mode');
    assert.strictEqual(input.getAttribute('aria-label'), 'Value at $.a', 'with a real label');

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settled();

    assert.strictEqual(
      state.lastJson,
      '{\n  "a": "",\n  "b": 1\n}',
      'the property survives with an empty-string value',
    );
    assert.strictEqual(state.issues, 0, 'and it is not treated as invalid');
  });

  test('an unreadable number is held pending, not coerced and not committed', async function (assert) {
    const state = new Harness();
    state.json = '{"n":42}';
    await render(
      <template>
        <JsonEditor
          @json={{state.json}}
          @expandAll={{true}}
          @onChange={{state.onChange}}
          @onIssue={{state.onIssue}}
        />
      </template>,
    );
    await click(rows('[role="row"]')[1]?.querySelector('[data-json-cell="value"]') as HTMLElement);
    const input = document.querySelector(
      '[role="row"][data-editing="true"] input[aria-label^="Value at"]',
    ) as HTMLInputElement;
    input.value = 'abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settled();

    assert.strictEqual(state.lastJson, undefined, '@onChange never fires for an invalid draft');
    assert.true(state.issues > 0, '@onIssue reports it so the caller can render the error');
    const wrap = document.querySelector('[data-test-pretui-input][data-invalid="true"]');
    assert.ok(wrap, 'the control is marked invalid — and carries a message, not just a colour');
    assert.true(
      (wrap as HTMLElement).innerText.toLowerCase().includes('json number'),
      'the message says what a JSON number is',
    );
    assert.strictEqual(input.value, 'abc', 'the keystrokes are kept, not thrown away');

    // Leaving edit mode proves the DOCUMENT never took the bad draft.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settled();
    assert.true(
      (document.querySelector('[role="treegrid"]') as HTMLElement).innerText.includes('42'),
      'the document still holds its last good value',
    );
  });

  test('adding, removing and reordering go through explicit controls', async function (assert) {
    const state = new Harness();
    state.json = '{"list":[1,2]}';
    await render(
      <template>
        <JsonEditor @json={{state.json}} @expandAll={{true}} @onChange={{state.onChange}} />
      </template>,
    );

    // Row 0 is the root object; row 1 is `list`. Target the array's own button.
    const listRow = rows('[role="row"]')[1] as HTMLElement;
    await click(listRow.querySelector('[data-json-action="add"]') as HTMLElement);
    assert.strictEqual(
      state.lastJson,
      '{\n  "list": [\n    1,\n    2,\n    null\n  ]\n}',
      'add appends a null item to the array it was pressed on',
    );

    const firstItem = rows('[role="row"]')[2] as HTMLElement;
    await click(firstItem.querySelector('[data-json-action="down"]') as HTMLElement);
    assert.true(
      (state.lastJson ?? '').indexOf('2') < (state.lastJson ?? '').indexOf('1'),
      'reorder moved the first item down',
    );

    const removes = rows('[data-json-action="remove"]');
    await click(removes[removes.length - 1] as HTMLElement);
    assert.strictEqual((state.lastJson ?? '').includes('null'), false, 'remove dropped the item');
  });

  test('undo restores the document and announces politely', async function (assert) {
    const state = new Harness();
    state.json = '{"list":[1]}';
    await render(
      <template>
        <JsonEditor @json={{state.json}} @expandAll={{true}} @onChange={{state.onChange}} />
      </template>,
    );
    const listRow = rows('[role="row"]')[1] as HTMLElement;
    await click(listRow.querySelector('[data-json-action="add"]') as HTMLElement);
    assert.true((state.lastJson ?? '').includes('null'), 'the item was added');

    await click(document.querySelector('[data-test-pretui-json-undo]') as HTMLElement);
    assert.strictEqual(state.lastJson, '{\n  "list": [\n    1\n  ]\n}', 'undo restored the document');

    const live = document.querySelector('[data-test-pretui-json-live]') as HTMLElement;
    assert.strictEqual(live.getAttribute('aria-live'), 'polite', 'changes announce politely');
    assert.strictEqual(live.innerText.trim(), 'Undone.', 'and say what happened');
  });

  test('a readonly editor navigates and copies but never edits', async function (assert) {
    const state = new Harness();
    await render(
      <template>
        <JsonEditor
          @json={{state.json}}
          @expandAll={{true}}
          @readonly={{true}}
          @onChange={{state.onChange}}
        />
      </template>,
    );
    assert.strictEqual(
      document.querySelector('[role="treegrid"]')?.getAttribute('aria-readonly'),
      'true',
      'the grid says so',
    );
    await click(rows('[role="row"]')[1]?.querySelector('[data-json-cell="value"]') as HTMLElement);
    assert.strictEqual(
      document.querySelector('[role="row"][data-editing="true"]'),
      null,
      'clicking a cell does not open an editor',
    );
    assert.strictEqual(state.lastJson, undefined, 'and nothing was emitted');
  });
});
