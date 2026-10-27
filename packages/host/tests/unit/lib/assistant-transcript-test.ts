import { module, test } from 'qunit';

import {
  compactDiff,
  resultDiff,
  DIFF_IN_DETAIL,
} from '@cardstack/host/lib/realm-runner/edits';
import { settledTitle } from '@cardstack/host/lib/tool-title';
import { turnSummary } from '@cardstack/host/lib/turn-summary';

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
    for (let [title, settled] of [
      ['Making the hero image', 'Made the hero image'],
      ['Writing tests', 'Wrote tests'],
      ['Running the script', 'Ran the script'],
      ['Updating the prices', 'Updated the prices'],
      ['Replace the header', 'Replaced the header'],
      ['The header patch', 'The header patch'],
      ['New card for Lena', 'New card for Lena'],
    ]) {
      assert.strictEqual(settledTitle(title!, 'Script'), settled);
    }
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

  test("a result's diff is read from detail when its base has no diff field", function (assert) {
    let diff = compactDiff({ url: URL_A, after: '# Notes' })!;
    assert.strictEqual(
      resultDiff({ detail: `Source saved.${DIFF_IN_DETAIL}${diff}` }),
      diff,
    );
    assert.strictEqual(resultDiff({ detail: 'Source saved.' }), undefined);
  });
});
