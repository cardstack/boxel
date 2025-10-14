import { module, test } from 'qunit';

import { applyBoxelFormatting } from '@cardstack/host/utils/editor/boxel-formatter';

module('Unit | Utils | editor | applyBoxelFormatting', function () {
  test('applies formatted output when lint command changes content', async function (assert) {
    assert.expect(8);

    let lintArgs;
    let lintAndFix = async (input: any) => {
      lintArgs = input;
      return { output: 'formatted-content' };
    };

    let modelValue = 'original-content';
    let pushedOperations: any[] = [];

    let model = {
      getValue() {
        return modelValue;
      },
      getFullModelRange() {
        return { fake: 'range' };
      },
      pushEditOperations(_before: unknown, operations: any[]) {
        pushedOperations = operations;
        modelValue = operations[0]?.text;
      },
    };

    let undoStopCount = 0;
    let editor = {
      pushUndoStop() {
        undoStopCount++;
      },
    };

    let result = await applyBoxelFormatting({
      lintAndFix,
      realm: 'https://example.com/',
      filename: 'example.gts',
      fileContent: 'original-content',
      model,
      editor,
    });

    assert.ok(lintArgs, 'lint command invoked');
    let capturedArgs = lintArgs as any;
    assert.strictEqual(capturedArgs.realm, 'https://example.com/');
    assert.strictEqual(capturedArgs.filename, 'example.gts');
    assert.strictEqual(capturedArgs.fileContent, 'original-content');
    assert.deepEqual(pushedOperations, [
      { range: { fake: 'range' }, text: 'formatted-content' },
    ]);
    assert.deepEqual(result, { output: 'formatted-content', changed: true });
    assert.strictEqual(modelValue, 'formatted-content');
    assert.strictEqual(undoStopCount, 2);
  });

  test('returns unchanged when lint command produces no output change', async function (assert) {
    assert.expect(2);

    let lintAndFix = async () => ({ output: 'same-content' });
    let model = {
      getValue() {
        return 'same-content';
      },
      getFullModelRange() {
        return {};
      },
      pushEditOperations() {
        assert.ok(false, 'pushEditOperations should not be called');
      },
    };

    let editor = {
      pushUndoStop() {
        assert.ok(false, 'pushUndoStop should not be called');
      },
    };

    let result = await applyBoxelFormatting({
      lintAndFix,
      realm: 'https://example.com/',
      filename: 'example.gts',
      fileContent: 'same-content',
      model,
      editor,
    });

    assert.deepEqual(result, { output: 'same-content', changed: false });

    let emptyResult = await applyBoxelFormatting({
      lintAndFix: async () => ({ output: undefined }),
      realm: 'https://example.com/',
      filename: 'example.gts',
      fileContent: 'same-content',
      model,
      editor,
    });

    assert.deepEqual(emptyResult, { output: undefined, changed: false });
  });

  test('bails out when editor content changes before applying formatting', async function (assert) {
    assert.expect(3);

    let lintCalled = false;
    let modelValue = 'original-content';
    let lintAndFix = async () => {
      lintCalled = true;
      modelValue = 'user-edited-content';
      return { output: 'formatted-content' };
    };

    let model = {
      getValue() {
        return modelValue;
      },
      getFullModelRange() {
        return {};
      },
      pushEditOperations() {
        assert.ok(
          false,
          'pushEditOperations should not be called when content changed',
        );
      },
    };

    let editor = {
      pushUndoStop() {
        assert.ok(
          false,
          'pushUndoStop should not be called when content changed',
        );
      },
    };

    let result = await applyBoxelFormatting({
      lintAndFix,
      realm: 'https://example.com/',
      filename: 'example.gts',
      fileContent: 'original-content',
      model,
      editor,
    });

    assert.true(lintCalled, 'lint command invoked');
    assert.deepEqual(result, { output: undefined, changed: false });
    assert.strictEqual(
      modelValue,
      'user-edited-content',
      'current editor value is preserved when content changed before formatting could apply',
    );
  });
});
