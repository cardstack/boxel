import { module, test } from 'qunit';

import {
  applyUndo,
  compactDiff,
  parseCompactDiff,
  planUndo,
  resultDiff,
  DIFF_IN_DETAIL,
  type UndoFiles,
} from '@cardstack/host/lib/realm-runner/edits';
import { settledTitle } from '@cardstack/host/lib/tool-title';
import { turnSummary } from '@cardstack/host/lib/turn-summary';

function memoryFiles(initial: Record<string, string>): {
  files: UndoFiles;
  store: Map<string, string>;
} {
  let store = new Map(Object.entries(initial));
  return {
    store,
    files: {
      read: async (url) => store.get(url),
      write: async (url, content) => {
        store.set(url, content);
      },
      delete: async (url) => {
        store.delete(url);
      },
      binaryDigest: async () => undefined,
    },
  };
}

const URL_A = 'https://realm.test/notes/plan.md';

module('Unit | Lib | assistant transcript', function () {
  test('a settled title says what the call did, in the past tense', function (assert) {
    assert.strictEqual(
      settledTitle(
        'Open the relaunch code and add an accent-colour border to the poster',
        'Edit',
      ),
      'Opened the relaunch code and added an accent-colour border to the poster',
    );
    assert.strictEqual(
      settledTitle(
        'Generate the cover image after your approval because it uses credit',
        'Script',
      ),
      'Generated the cover image',
      'the why is dropped',
    );
    assert.strictEqual(
      settledTitle('Read file: source-code-editing/SKILL.md', 'Read'),
      'source-code-editing/SKILL.md',
      'a lead word the verb label already says is dropped, and a path keeps its case',
    );
    assert.strictEqual(
      settledTitle("I'll find two logos per brand", 'Script'),
      'Found two logos per brand',
    );
  });

  test('a folded turn says what its calls did, counted, with its time', function (assert) {
    assert.strictEqual(
      turnSummary(
        ['run-realm-code_6b92', 'run-realm-code_6b92', 'checkCorrectness'],
        { seconds: 92 },
      ),
      'Ran 2 scripts, checked 1 file · 1m 32s',
    );
    assert.strictEqual(
      turnSummary(['ResearchTool_3f9a1c'], { failed: 1, stopped: 1 }),
      'Researched 1 question · 1 failed · 1 stopped',
    );
  });

  test('Undo from a compact diff puts each hunk back', async function (assert) {
    let before = Array.from({ length: 12 }, (_u, i) => `line ${i + 1}`).join(
      '\n',
    );
    let after = before.replace('line 4', 'line four');
    let diff = compactDiff({ url: URL_A, before, after })!;
    assert.true(parseCompactDiff(diff).complete);
    let { files, store } = memoryFiles({ [URL_A]: after });
    let plans = await planUndo([{ url: URL_A, diff }], files);
    assert.strictEqual(await applyUndo(plans, files), 'Restored 1 file');
    assert.strictEqual(store.get(URL_A), before);
  });

  test('Undo changes nothing when a file moved on since the call', async function (assert) {
    let before = 'a\nb\nc';
    let after = 'a\nB\nc';
    let { files, store } = memoryFiles({ [URL_A]: 'a\nB\nc\nd' });
    let plans = await planUndo(
      [{ url: URL_A, edit: { url: URL_A, before, after } }],
      files,
    );
    await assert.rejects(applyUndo(plans, files), /changed since the run/);
    assert.strictEqual(
      store.get(URL_A),
      'a\nB\nc\nd',
      'the file is left as it is',
    );
  });

  test("a result's diff is read from detail when its base has no diff field", function (assert) {
    let diff = compactDiff({ url: URL_A, after: '# Notes' })!;
    assert.strictEqual(
      resultDiff({ detail: `Source saved.${DIFF_IN_DETAIL}${diff}` }),
      diff,
    );
    assert.strictEqual(resultDiff({ detail: 'Source saved.' }), undefined);
  });
});
