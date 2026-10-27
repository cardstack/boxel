// Pretui — DiffBlock unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DiffBlock, diffHunks, lineDiff } from './diff-block';
import type {
  DiffComment,
  DiffHunk,
  DiffHunkState,
  DiffLine,
  DiffSide,
} from './diff-block';

const SMALL: DiffLine[] = [
  { text: 'name: Wuyi' },
  { op: 'del', text: 'lots: 11' },
  { op: 'add', text: 'lots: 12' },
];
const LONG: DiffLine[] = Array.from({ length: 12 }, (_u, i) => ({ text: 'line ' + (i + 1) }));

// line 2 replaced: the removal and its replacement are both numbered 2
const REPLACED = lineDiff('one\ntwo\nthree\n', 'one\nTWO\nthree\n');

// two changes far enough apart to make two hunks
const TWO_HUNKS = lineDiff(
  Array.from({ length: 20 }, (_u, i) => `row ${i + 1}`).join('\n'),
  Array.from({ length: 20 }, (_u, i) => (i === 1 || i === 17 ? `ROW ${i + 1}` : `row ${i + 1}`)).join('\n'),
  { context: 1 },
);

function block(): HTMLElement {
  return document.querySelector('[data-test-pretui-diff-block]') as HTMLElement;
}
function lines(): HTMLElement[] {
  return Array.from(block().querySelectorAll('[data-test-pretui-diff-line]')) as HTMLElement[];
}
function toggle(): HTMLButtonElement | null {
  return block().querySelector('[data-test-pretui-diff-toggle]');
}
function all(selector: string): HTMLElement[] {
  return Array.from(block().querySelectorAll(selector)) as HTMLElement[];
}

class Review {
  @tracked states: Record<number, DiffHunkState> = {};
  keep = (hunk: DiffHunk) => {
    this.states = { ...this.states, [hunk.index]: 'kept' };
  };
  revert = (hunk: DiffHunk) => {
    this.states = { ...this.states, [hunk.index]: 'reverted' };
  };
}

module('Pretui | components/diff-block', function (hooks) {
  setupCardTest(hooks);

  test('prefixes each line by its op and reflects the op for the CSS', async function (assert) {
    await render(<template><DiffBlock @lines={{SMALL}} @receipt='applied 2026-09-04 · r-8812' /></template>);
    assert.deepEqual(lines().map((l) => l.textContent), ['  name: Wuyi', '- lots: 11', '+ lots: 12'], 'the sign is text, so it survives greyscale');
    assert.deepEqual(lines().map((l) => l.dataset['op']), [undefined, 'del', 'add']);
    assert.strictEqual(block().querySelector('[data-test-pretui-diff-receipt]')?.textContent?.trim(), 'applied 2026-09-04 · r-8812');
    assert.strictEqual(toggle(), null, 'a short diff has nothing to collapse');
  });

  test('a long diff collapses to eight lines with a toggle that says how many are hidden', async function (assert) {
    await render(<template><DiffBlock @lines={{LONG}} /></template>);
    assert.strictEqual(lines().length, 8);
    assert.strictEqual(toggle()?.textContent?.trim(), '4 more lines');
    await click(toggle() as HTMLElement);
    assert.strictEqual(lines().length, 12);
    assert.strictEqual(toggle()?.textContent?.trim(), 'collapse');
  });

  test('takes a different fold point', async function (assert) {
    await render(<template><DiffBlock @lines={{LONG}} @maxLines={{3}} /></template>);
    assert.strictEqual(lines().length, 3);
    assert.strictEqual(toggle()?.textContent?.trim(), '9 more lines');
  });

  test('lineDiff numbers a removal in the old file and its replacement in the new one', function (assert) {
    assert.deepEqual(
      REPLACED.map((l) => [l.op ?? ' ', l.n, l.text]),
      [
        [' ', 1, 'one'],
        ['del', 2, 'two'],
        ['add', 2, 'TWO'],
        [' ', 3, 'three'],
      ],
    );
  });

  test('diffHunks splits the lines at each skip and counts each run', function (assert) {
    assert.deepEqual(
      diffHunks(TWO_HUNKS).map((h) => [h.start, h.end, h.added, h.removed]),
      [
        [0, 3, 1, 1],
        [5, 8, 1, 1],
      ],
    );
    assert.strictEqual(TWO_HUNKS[4]?.skip, 13, 'the unchanged middle is one skip line');
  });

  test('a comment on a removed line and one on its replacement each show under their own line', async function (assert) {
    const comments: DiffComment[] = [
      { line: 2, side: 'old', author: 'Ana', text: 'why drop this?' },
      { line: 2, author: 'Bo', text: 'caps on purpose' },
    ];
    await render(<template><DiffBlock @lines={{REPLACED}} @lineNumbers={{true}} @comments={{comments}} /></template>);
    assert.deepEqual(
      all('[data-test-pretui-diff-comment]').map((c) => [c.dataset['testPretuiDiffComment'], c.textContent?.replace(/\s+/g, ' ').trim()]),
      [
        ['old:2', 'Ana why drop this?'],
        ['new:2', 'Bo caps on purpose'],
      ],
      'each comment shows once, under the side it was made on',
    );
  });

  test('a comment opened on a removed line opens one editor and reports the old side', async function (assert) {
    let saved: [number, string, DiffSide][] = [];
    const onComment = (line: number, text: string, side: DiffSide) => {
      saved.push([line, text, side]);
    };
    await render(<template><DiffBlock @lines={{REPLACED}} @lineNumbers={{true}} @onComment={{onComment}} /></template>);
    let opener = block().querySelector('[data-test-pretui-diff-comment-on="old:2"]') as HTMLElement;
    assert.strictEqual(opener.getAttribute('aria-label'), 'Comment on removed line 2');
    await click(opener);
    assert.deepEqual(
      all('[data-test-pretui-diff-comment-editor]').map((e) => e.dataset['testPretuiDiffCommentEditor']),
      ['old:2'],
      'only the removed line opens an editor',
    );
    await fillIn('[data-test-pretui-diff-comment-field]', 'keep the old name');
    await click('[data-test-pretui-diff-comment-save]');
    assert.deepEqual(saved, [[2, 'keep the old name', 'old']]);
    assert.strictEqual(all('[data-test-pretui-diff-comment-editor]').length, 0);
    assert.strictEqual(document.activeElement, opener, 'focus returns to the line number that opened the editor');
  });

  test('Escape closes the comment editor and returns focus to its line number', async function (assert) {
    const onComment = () => undefined;
    await render(<template><DiffBlock @lines={{REPLACED}} @lineNumbers={{true}} @onComment={{onComment}} /></template>);
    let opener = block().querySelector('[data-test-pretui-diff-comment-on="new:2"]') as HTMLElement;
    await click(opener);
    await triggerKeyEvent('[data-test-pretui-diff-comment-field]', 'keydown', 'Escape');
    assert.strictEqual(all('[data-test-pretui-diff-comment-editor]').length, 0);
    assert.strictEqual(document.activeElement, opener);
  });

  test('the split view keeps the hunk bars, comment buttons and comments', async function (assert) {
    let review = new Review();
    const comments: DiffComment[] = [{ line: 2, side: 'old', author: 'Ana', text: 'why?' }];
    const onComment = () => undefined;
    await render(
      <template>
        <DiffBlock
          @lines={{TWO_HUNKS}}
          @maxLines={{100}}
          @view='split'
          @lineNumbers={{true}}
          @onKeepHunk={{review.keep}}
          @onRevertHunk={{review.revert}}
          @hunkStates={{review.states}}
          @comments={{comments}}
          @onComment={{onComment}}
        />
      </template>,
    );
    assert.strictEqual(block().dataset['view'], 'split');
    assert.deepEqual(
      all('[data-test-pretui-diff-hunk]').map((h) => h.dataset['testPretuiDiffHunk']),
      ['0', '1'],
      'each hunk has its bar',
    );
    assert.strictEqual(all('[data-test-pretui-diff-keep]').length, 2);
    assert.strictEqual(all('[data-test-pretui-diff-revert]').length, 2);
    assert.ok(block().querySelector('[data-test-pretui-diff-comment-on="old:2"]'), 'a removed line opens a comment');
    assert.ok(block().querySelector('[data-test-pretui-diff-comment-on="new:2"]'), 'an added line opens a comment');
    assert.deepEqual(
      all('[data-test-pretui-diff-comment]').map((c) => c.dataset['testPretuiDiffComment']),
      ['old:2'],
      'the comment shows once, on the old side',
    );
    await click('[data-test-pretui-diff-revert="1"]');
    assert.strictEqual(block().querySelector('[data-test-pretui-diff-hunk-state="1"]')?.textContent?.trim(), 'reverted');
    assert.ok(
      lines().filter((l) => l.dataset['op']).slice(-2).every((l) => l.dataset['state'] === 'reverted'),
      'the reverted hunk is struck on both sides',
    );
  });

  test('a decided hunk takes the focus its Keep button held', async function (assert) {
    let review = new Review();
    await render(
      <template>
        <DiffBlock
          @lines={{TWO_HUNKS}}
          @maxLines={{100}}
          @onKeepHunk={{review.keep}}
          @onRevertHunk={{review.revert}}
          @hunkStates={{review.states}}
        />
      </template>,
    );
    await click('[data-test-pretui-diff-keep="0"]');
    let state = block().querySelector('[data-test-pretui-diff-hunk-state="0"]') as HTMLElement;
    assert.strictEqual(state.textContent?.trim(), 'kept');
    assert.strictEqual(document.activeElement, state, 'focus stays on the hunk, not the page');
  });
});
