import QUnit from 'qunit';
const { module, test } = QUnit;
import { mergeJsonValues, mergeText, mergeTrees } from '../src/merge.ts';

function tree(entries: Record<string, string>): Map<string, Buffer> {
  return new Map(
    Object.entries(entries).map(([path, text]) => [path, Buffer.from(text)]),
  );
}

const BASE = 'a\nb\nc\nd\ne\n';

module('three-way merge', function () {
  test('an edit on one side only is taken', function (assert) {
    assert.deepEqual(mergeText(BASE, BASE, 'a\nB!\nc\nd\ne\n'), {
      text: 'a\nB!\nc\nd\ne\n',
      conflicted: false,
    });
    assert.deepEqual(mergeText(BASE, 'a\nb\nc\nd\nE!\n', BASE), {
      text: 'a\nb\nc\nd\nE!\n',
      conflicted: false,
    });
  });

  test('edits in different places both survive', function (assert) {
    let merged = mergeText(BASE, 'A!\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE!\n');
    assert.false(merged.conflicted);
    assert.strictEqual(merged.text, 'A!\nb\nc\nd\nE!\n');
  });

  test('the same edit on both sides is not a conflict', function (assert) {
    let both = 'a\nb\nCC\nd\ne\n';
    assert.deepEqual(mergeText(BASE, both, both), {
      text: both,
      conflicted: false,
    });
  });

  test('insertions and deletions merge', function (assert) {
    let ours = 'a\nb\nc\nc2\nd\ne\n'; // upstream inserted after c
    let theirs = 'a\nc\nd\ne\n'; // proposal deleted b
    let merged = mergeText(BASE, ours, theirs);
    assert.false(merged.conflicted, merged.text);
    assert.strictEqual(merged.text, 'a\nc\nc2\nd\ne\n');
  });

  test('the same line changed differently conflicts, with all three sides shown', function (assert) {
    let merged = mergeText(BASE, 'a\nUP\nc\nd\ne\n', 'a\nMINE\nc\nd\ne\n');
    assert.true(merged.conflicted);
    assert.true(merged.text.includes('<<<<<<< upstream\nUP\n'));
    assert.true(merged.text.includes('||||||| base\nb\n'));
    assert.true(merged.text.includes('=======\nMINE\n'));
    assert.true(merged.text.includes('>>>>>>> proposal\n'));
    assert.true(
      merged.text.startsWith('a\n') && merged.text.endsWith('c\nd\ne\n'),
      'the untouched lines around it are intact',
    );
  });

  test('a file appended on both sides conflicts only at the tail', function (assert) {
    let merged = mergeText(BASE, `${BASE}up\n`, `${BASE}mine\n`);
    assert.true(merged.conflicted);
    assert.true(merged.text.startsWith(BASE), merged.text);
  });

  test('whitespace and missing trailing newlines are preserved', function (assert) {
    let merged = mergeText('a\nb', 'a\nb', 'a\nb\nc');
    assert.false(merged.conflicted);
    assert.strictEqual(merged.text, 'a\nb\nc');
  });
});

module('three-way merge over trees', function () {
  test('each side keeps what only it changed', function (assert) {
    let result = mergeTrees(
      tree({ 'a.js': '1\n', 'b.js': '1\n', 'c.js': '1\n' }),
      tree({ 'a.js': 'up\n', 'b.js': '1\n', 'c.js': '1\n' }),
      tree({ 'a.js': '1\n', 'b.js': 'mine\n', 'c.js': '1\n' }),
    );
    assert.deepEqual(result.conflicts, []);
    assert.strictEqual(result.files.get('a.js')!.toString(), 'up\n');
    assert.strictEqual(result.files.get('b.js')!.toString(), 'mine\n');
    assert.strictEqual(result.files.get('c.js')!.toString(), '1\n');
  });

  test('adds from both sides land side by side', function (assert) {
    let result = mergeTrees(
      tree({ 'a.js': '1\n' }),
      tree({ 'a.js': '1\n', 'up.js': 'u\n' }),
      tree({ 'a.js': '1\n', 'mine.js': 'm\n' }),
    );
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual([...result.files.keys()].sort(), [
      'a.js',
      'mine.js',
      'up.js',
    ]);
  });

  test('a delete on one side and an edit on the other is a conflict, not a silent loss', function (assert) {
    let result = mergeTrees(
      tree({ 'a.js': '1\n' }),
      tree({}),
      tree({ 'a.js': 'mine\n' }),
    );
    assert.deepEqual(result.conflicts, ['a.js']);
    assert.strictEqual(
      result.files.get('a.js')!.toString(),
      'mine\n',
      'the edit is kept so nothing is destroyed while a person decides',
    );
  });

  test('both deleting the same file is agreement', function (assert) {
    let result = mergeTrees(tree({ 'a.js': '1\n' }), tree({}), tree({}));
    assert.deepEqual(result.conflicts, []);
    assert.strictEqual(result.files.size, 0);
  });

  test('binary files both changed conflict rather than being line-merged', function (assert) {
    let base = new Map([['x.png', Buffer.from([0, 1, 2])]]);
    let ours = new Map([['x.png', Buffer.from([0, 9, 9])]]);
    let theirs = new Map([['x.png', Buffer.from([0, 7, 7])]]);
    let result = mergeTrees(base, ours, theirs);
    assert.deepEqual(result.conflicts, ['x.png']);
    assert.deepEqual([...result.files.get('x.png')!], [0, 7, 7]);
  });
});

module('JSON merges as data, not as lines', function () {
  test('different keys changed on each side both survive', function (assert) {
    let merged = mergeJsonValues(
      { a: 1, b: 2 },
      { a: 9, b: 2 },
      { a: 1, b: 8 },
    );
    assert.false(merged.conflicted);
    assert.deepEqual(merged.value, { a: 9, b: 8 });
  });

  test('adds from both sides merge; the same key changed differently conflicts', function (assert) {
    let added = mergeJsonValues({ a: 1 }, { a: 1, up: true }, { a: 1, mine: true });
    assert.false(added.conflicted);
    assert.deepEqual(added.value, { a: 1, up: true, mine: true });

    let clash = mergeJsonValues({ a: 1 }, { a: 2 }, { a: 3 });
    assert.true(clash.conflicted);
  });

  test('nested objects merge key by key', function (assert) {
    let merged = mergeJsonValues(
      { deck: { packages: { p: { version: '1.0.0', entry: 'e' } } } },
      { deck: { packages: { p: { version: '1.1.0', entry: 'e' } } } },
      {
        deck: {
          packages: {
            p: { version: '1.0.0', entry: 'e', forkedFrom: { treeHash: 'x' } },
          },
        },
      },
    );
    assert.false(
      merged.conflicted,
      "a version bump next to an added key is not a conflict — the line merge said it was",
    );
    assert.deepEqual(merged.value, {
      deck: {
        packages: {
          p: { version: '1.1.0', entry: 'e', forkedFrom: { treeHash: 'x' } },
        },
      },
    });
  });

  test('a delete loses to an edit, loudly', function (assert) {
    let untouched = mergeJsonValues({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2 });
    assert.false(untouched.conflicted);
    assert.deepEqual(untouched.value, { a: 1 }, 'deleted on one side only');

    let clash = mergeJsonValues({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 3 });
    assert.true(clash.conflicted);
    assert.deepEqual(clash.value, { a: 1, b: 3 }, 'the edit is kept');
  });

  test('arrays are atomic — a merge never invents an order', function (assert) {
    let merged = mergeJsonValues({ xs: [1, 2] }, { xs: [1, 2, 3] }, { xs: [0, 1, 2] });
    assert.true(merged.conflicted);
  });

  test('a .json file in a tree takes the structural path', function (assert) {
    let result = mergeTrees(
      new Map([['m.json', Buffer.from('{"a":1,"b":2}')]]),
      new Map([['m.json', Buffer.from('{"a":9,"b":2}')]]),
      new Map([['m.json', Buffer.from('{"a":1,"b":8}')]]),
    );
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(JSON.parse(result.files.get('m.json')!.toString()), {
      a: 9,
      b: 8,
    });
  });

  test('unparseable JSON falls back to the line merge rather than pretending', function (assert) {
    let result = mergeTrees(
      new Map([['m.json', Buffer.from('{\n"a": 1\n}\n')]]),
      new Map([['m.json', Buffer.from('{\n"a": 9\n}\n')]]),
      new Map([['m.json', Buffer.from('not json at all\n')]]),
    );
    assert.deepEqual(result.conflicts, ['m.json']);
    assert.true(result.files.get('m.json')!.toString().includes('<<<<<<<'));
  });
});
