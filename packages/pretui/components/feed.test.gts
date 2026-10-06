// Pretui — Feed unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Feed } from './feed';
import type { FeedItem } from './feed';

const ITEMS: FeedItem[] = [
  { id: 'a', label: 'Lot received', text: 'Twelve crates' },
  { id: 'b', text: 'Panel scheduled' },
  { id: 'c', label: 'Published', text: 'Listing is live' },
];

/** FeedItem's index signature is `unknown`; the template needs a string. */
const textOf = (item: FeedItem): string => String(item['text']);

function host(): HTMLElement {
  return document.querySelector('[data-test-pretui-feed]') as HTMLElement;
}
function feed(): HTMLElement {
  return host().querySelector('[role="feed"]') as HTMLElement;
}
function articles(): HTMLElement[] {
  return Array.from(host().querySelectorAll('article')) as HTMLElement[];
}
function roving(): string | undefined {
  return articles().find((a) => a.tabIndex === 0)?.dataset['feedIndex'];
}

module('Pretui | components/feed', function (hooks) {
  setupCardTest(hooks);

  test('is a role=feed of labelled articles with position and set size', async function (assert) {
    await render(
      <template>
        <Feed @items={{ITEMS}}>
          <:item as |item index|><span data-test-body>{{index}}:{{textOf item}}</span></:item>
        </Feed>
      </template>,
    );
    assert.strictEqual(feed().getAttribute('aria-label'), 'Activity');
    assert.strictEqual(feed().getAttribute('aria-busy'), 'false');
    assert.deepEqual(articles().map((a) => a.getAttribute('aria-posinset')), ['1', '2', '3']);
    assert.deepEqual(articles().map((a) => a.getAttribute('aria-setsize')), ['3', '3', '3']);
    assert.deepEqual(
      articles().map((a) => a.getAttribute('aria-label')),
      ['Lot received', 'Update 2 of 3', 'Published'],
      'role=feed requires every article to be named; a missing one is synthesised from its position',
    );
    assert.deepEqual(Array.from(host().querySelectorAll('[data-test-body]')).map((b) => b.textContent), ['0:Twelve crates', '1:Panel scheduled', '2:Listing is live']);
    assert.strictEqual(roving(), '0', 'one tab stop');
  });

  test('PageDown / PageUp move the roving article from anywhere in the feed; Home / End only from an article', async function (assert) {
    await render(<template><Feed @items={{ITEMS}}><:item as |item|>{{textOf item}}</:item></Feed></template>);
    await triggerKeyEvent(feed(), 'keydown', 'PageDown');
    assert.strictEqual(roving(), '1');
    assert.strictEqual(document.activeElement, articles()[1], 'real focus follows the roving article');
    await triggerKeyEvent(feed(), 'keydown', 'End');
    assert.strictEqual(roving(), '1', 'End from a control inside an article must keep its native meaning');
    await triggerKeyEvent(articles()[1] as HTMLElement, 'keydown', 'End');
    assert.strictEqual(roving(), '2');
    await triggerKeyEvent(feed(), 'keydown', 'PageUp');
    assert.strictEqual(roving(), '1');
    await triggerKeyEvent(articles()[1] as HTMLElement, 'keydown', 'Home');
    assert.strictEqual(roving(), '0');
  });

  test('loading sets aria-busy and shows a skeleton tail outside the feed', async function (assert) {
    await render(<template><Feed @items={{ITEMS}} @loading={{true}} @skeletonCount={{3}}><:item as |item|>{{textOf item}}</:item></Feed></template>);
    assert.strictEqual(feed().getAttribute('aria-busy'), 'true');
    let tail = host().querySelector('.pretui-feed-loading') as HTMLElement;
    assert.strictEqual(tail.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(tail.querySelectorAll('.pretui-feed-skeleton').length, 3);
    assert.notOk(feed().contains(tail), 'a feed\'s children must be articles, and a placeholder is not one');
  });

  test('an empty feed shows the default EmptyState, or the empty block, but not while loading', async function (assert) {
    const NONE: FeedItem[] = [];
    await render(<template><Feed @items={{NONE}}><:item as |item|>{{textOf item}}</:item></Feed></template>);
    assert.ok(host().querySelector('[data-test-pretui-empty]'));

    await render(<template><Feed @items={{NONE}}><:item as |item|>{{textOf item}}</:item><:empty><p data-test-none>Quiet</p></:empty></Feed></template>);
    assert.ok(host().querySelector('[data-test-none]'));

    await render(<template><Feed @items={{NONE}} @loading={{true}} @label='Lots'><:item as |item|>{{textOf item}}</:item></Feed></template>);
    assert.strictEqual(host().querySelector('[data-test-pretui-empty]'), null, 'nothing yet is not nothing at all');
    assert.strictEqual(feed().getAttribute('aria-label'), 'Lots');
  });
});
