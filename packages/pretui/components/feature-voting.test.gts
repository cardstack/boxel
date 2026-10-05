// Pretui — FeatureVoting unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FeatureVoting } from './feature-voting';
import type { FeatureVote } from './feature-voting';

const BALLOT: FeatureVote[] = [
  { id: 'a', title: 'Dark mode', votes: 3 },
  { id: 'b', title: 'Bulk export', votes: 12, voted: true, tag: 'Planned' },
  { id: 'c', title: 'Audit log', votes: 3, description: 'Who changed what, when.' },
];

function section(): HTMLElement {
  return document.querySelector('[data-test-pretui-feature-voting]') as HTMLElement;
}
function rows(): HTMLElement[] {
  return Array.from(section().querySelectorAll('.pretui-vote-row')) as HTMLElement[];
}
function names(): string[] {
  return rows().map((r) => r.querySelector('.pretui-vote-name')?.textContent?.replace(/\s+/g, ' ').trim() as string);
}
function buttons(): HTMLButtonElement[] {
  return Array.from(section().querySelectorAll('[data-test-pretui-feature-voting-button]')) as HTMLButtonElement[];
}

module('Pretui | components/feature-voting', function (hooks) {
  setupCardTest(hooks);

  test('sorts the ballot by tally with a stable title tiebreak, and totals the votes', async function (assert) {
    await render(<template><FeatureVoting @features={{BALLOT}} /></template>);
    assert.strictEqual(section().getAttribute('aria-label'), 'What should we build next?');
    assert.strictEqual(section().querySelector('.pretui-vote-tally')?.textContent?.trim(), '18 votes cast');
    assert.deepEqual(names(), ['Bulk export Planned', 'Audit log', 'Dark mode'], '12, then the two 3s alphabetically — never insertion order');
    assert.deepEqual(rows().map((r) => r.querySelector('.pretui-vote-count')?.textContent?.trim()), ['12 votes', '3 votes', '3 votes']);
    assert.deepEqual(
      rows().map((r) => r.querySelector('.pretui-vote-bar')?.getAttribute('style')),
      ['--pretui-vote-share: 100%', '--pretui-vote-share: 25%', '--pretui-vote-share: 25%'],
      'bars are relative to the leader',
    );
  });

  test('keeps the caller order on request', async function (assert) {
    await render(<template><FeatureVoting @features={{BALLOT}} @sort='given' /></template>);
    assert.deepEqual(names(), ['Dark mode', 'Bulk export Planned', 'Audit log']);
  });

  test('each vote is a pressed toggle whose name says what pressing it does', async function (assert) {
    await render(<template><FeatureVoting @features={{BALLOT}} /></template>);
    assert.deepEqual(buttons().map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false']);
    assert.strictEqual(buttons()[0]?.getAttribute('aria-label'), 'Remove your vote for Bulk export, 12 votes');
    assert.strictEqual(buttons()[1]?.getAttribute('aria-label'), 'Upvote Audit log, 3 votes');
    assert.strictEqual(rows()[0]?.dataset['voted'], 'true');
    assert.strictEqual(rows()[0]?.querySelector('[data-test-pretui-chip]')?.textContent?.trim(), 'Planned');
    assert.strictEqual(rows()[1]?.querySelector('.pretui-vote-detail')?.textContent?.trim(), 'Who changed what, when.');
  });

  test('reports the feature and the state asked for, and never touches the tally itself', async function (assert) {
    let seen: [string, boolean][] = [];
    const onVote = (f: FeatureVote, voted: boolean) => seen.push([f.id, voted]);
    await render(<template><FeatureVoting @features={{BALLOT}} @onVote={{onVote}} /></template>);
    await click(buttons()[0] as HTMLElement);
    await click(buttons()[1] as HTMLElement);
    assert.deepEqual(seen, [['b', false], ['c', true]], 'a request to remove, then a request to add');
    assert.strictEqual(section().querySelector('.pretui-vote-tally')?.textContent?.trim(), '18 votes cast', 'the number lives on a server; the caller owns it');
  });

  test('uses the singular, and takes a title and description', async function (assert) {
    const ONE: FeatureVote[] = [{ id: 'a', title: 'Dark mode', votes: 1 }];
    await render(<template><FeatureVoting @features={{ONE}} @title='Roadmap' @description='Vote once per feature.' /></template>);
    assert.strictEqual(section().querySelector('.pretui-vote-title')?.textContent?.trim(), 'Roadmap');
    assert.strictEqual(section().querySelector('.pretui-vote-desc')?.textContent?.trim(), 'Vote once per feature.');
    assert.strictEqual(section().querySelector('.pretui-vote-tally')?.textContent?.trim(), '1 vote cast');
    assert.strictEqual(rows()[0]?.querySelector('.pretui-vote-count')?.textContent?.trim(), '1 vote');
  });

  test('an empty ballot renders an EmptyState with the caller wording', async function (assert) {
    const NONE: FeatureVote[] = [];
    await render(<template><FeatureVoting @features={{NONE}} @emptyMessage='File the first idea.' /></template>);
    let empty = section().querySelector('[data-test-pretui-empty]') as HTMLElement;
    assert.ok(empty);
    assert.true(empty.textContent?.includes('File the first idea.'));
    assert.strictEqual(section().querySelector('.pretui-vote-tally')?.textContent?.trim(), '0 votes cast');
  });
});
