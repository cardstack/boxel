// Pretui — CopyFit unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CopyFit } from './copy-fit';
import { statusHue } from '../internal/ink';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-fitted]') as HTMLElement;
}
function media(): HTMLElement {
  return root().querySelector('.pretui-fitted-media') as HTMLElement;
}

module('Pretui | components/copy-fit', function (hooks) {
  setupCardTest(hooks);

  test('with no image the cover is a monogram tinted from a hash of the title, and the tile says it has no image', async function (assert) {
    await render(<template><CopyFit @title='Ledger' @eyebrow='App' @meta='12 cards' @footerLeft='v0.4' @footerRight='live' /></template>);
    assert.strictEqual(root().dataset['noImage'], 'true', 'so a parent grid can pick the cell aspect from the content');
    assert.strictEqual(media().dataset['cover'], 'mono');
    assert.strictEqual(media().querySelector('.pretui-fitted-mono')?.textContent, 'L');
    assert.ok(media().getAttribute('style')?.includes('--pretui-fitted-cover-hue: ' + statusHue('Ledger')), 'the same title is the same colour on every card by every author');
    assert.strictEqual(root().querySelector('.pretui-fitted-eyebrow')?.textContent?.trim(), 'App');
    assert.strictEqual(root().querySelector('.pretui-fitted-title')?.textContent?.trim(), 'Ledger');
    assert.strictEqual(root().querySelector('.pretui-fitted-meta')?.textContent?.trim(), '12 cards');
    assert.deepEqual(Array.from(root().querySelectorAll('.pretui-fitted-footer span')).map((s) => s.textContent), ['v0.4', 'live']);
    assert.strictEqual(root().getAttribute('role'), null);
  });

  test('footer blocks render the footer on their own and replace the string arg on their side', async function (assert) {
    await render(<template><CopyFit @title='Ledger' @footerRight='live'><:footerLeft><b data-test-left>v0.4</b></:footerLeft></CopyFit></template>);
    let sides = Array.from(root().querySelectorAll('.pretui-fitted-footer > span'));
    assert.ok(sides[0]?.querySelector('[data-test-left]'), 'the left block is yielded');
    assert.strictEqual(sides[1]?.textContent, 'live');

    await render(<template><CopyFit @title='Ledger'><:footerRight><b data-test-right>4.8</b></:footerRight></CopyFit></template>);
    assert.ok(root().querySelector('.pretui-fitted-footer [data-test-right]'), 'a block alone is enough to render the footer');
  });

  test('a monogram source keys the hue, not the single letter, so "Ledger" and "Lantern" do not collide', async function (assert) {
    await render(<template><CopyFit @title='Lantern' @monogram='Lantern' /></template>);
    assert.strictEqual(media().querySelector('.pretui-fitted-mono')?.textContent, 'L');
    assert.ok(media().getAttribute('style')?.includes(statusHue('Lantern')));
    assert.notStrictEqual(statusHue('Lantern'), statusHue('Ledger'));
  });

  test('an image or a media block replaces the monogram and the tile says it has one', async function (assert) {
    await render(<template><CopyFit @title='Photo' @media='https://example.test/a.png' @mediaBg='var(--chart-2)' /></template>);
    assert.strictEqual(root().dataset['noImage'], 'false');
    assert.strictEqual(media().dataset['cover'], 'image');
    assert.strictEqual(media().querySelector('img')?.getAttribute('alt'), '', 'the title beside it is the name; the picture is decoration');
    assert.ok(media().getAttribute('style')?.includes('--pretui-fitted-mediabg: var(--chart-2)'));

    await render(<template><CopyFit @title='Slot'><:media><svg data-test-art></svg></:media></CopyFit></template>);
    assert.strictEqual(media().dataset['cover'], 'slot');
    assert.ok(media().querySelector('[data-test-art]'));
  });

  test('refuses an unsafe cover hue or media background, and still paints the derived hue', async function (assert) {
    await render(<template><CopyFit @title='x' @coverHue='red; background: url(javascript:0)' @mediaBg='url(javascript:0)' /></template>);
    let style = media().getAttribute('style') ?? '';
    assert.notOk(style.includes('javascript'), 'the injection never reaches the DOM');
    assert.notOk(style.includes('--pretui-fitted-mediabg'), 'the media background is dropped whole');
    assert.strictEqual(
      media().style.getPropertyValue('--pretui-fitted-cover-hue'),
      statusHue('x'),
      'the caller hue is validated before it wins, so a rejected one falls back to the derived hue',
    );
  });

  test('loading is the same tree with bones, announced as a status', async function (assert) {
    await render(<template><CopyFit @title='Ledger' @loading={{true}} @loadingLabel='Fetching' /></template>);
    assert.strictEqual(root().dataset['loading'], 'true');
    assert.strictEqual(root().getAttribute('role'), 'status');
    assert.strictEqual(root().getAttribute('aria-busy'), 'true');
    assert.strictEqual(media().dataset['cover'], 'loading');
    assert.strictEqual(root().querySelector('.pretui-vh')?.textContent?.trim(), 'Fetching');
    assert.deepEqual(
      Array.from(root().querySelectorAll('.pretui-fitted-bone')).map((b) => b.className.replace(/\s*pretui-fitted-bone\s*/, ' ').trim()),
      ['pretui-eyebrow pretui-fitted-eyebrow', 'pretui-fitted-title', 'pretui-fitted-meta', 'pretui-fitted-bone-foot', 'pretui-fitted-bone-foot'],
      'the bones are the same ladder as the text — eyebrow, title, meta, two footer spans — so nothing moves when data lands',
    );
    assert.strictEqual(root().querySelector('.pretui-fitted-title')?.textContent?.trim(), '', 'no real text while loading');

    await render(<template><CopyFit @title='Ledger' @loading={{true}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-vh')?.textContent?.trim(), 'Loading', 'the default label');
  });

  test('omits the footer when neither side is given', async function (assert) {
    await render(<template><CopyFit @title='Bare' /></template>);
    assert.strictEqual(root().querySelector('.pretui-fitted-footer'), null);
  });
});
