// Pretui — Watermark unit tests: the layer is inert decoration, the content is
// untouched, and every source reaches CSS through the url guard.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Watermark } from './watermark';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

function layer(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-watermark-layer]');
}

module('Pretui | components/watermark', function (hooks) {
  setupCardTest(hooks);

  test('a text mark is an aria-hidden layer over content that stays readable', async function (assert) {
    await render(<template><Watermark @text='DRAFT' data-doc='invoice'><p class='t-body'>Invoice 1042</p></Watermark></template>);
    let root = document.querySelector('[data-test-pretui-watermark]') as HTMLElement;
    assert.strictEqual(root.getAttribute('data-doc'), 'invoice');
    assert.ok(document.querySelector('.t-body'), 'the content renders');
    assert.strictEqual(layer()?.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(layer()?.dataset['kind'], 'text');
    assert.ok(layer()?.getAttribute('style')?.includes('mask-image: url("data:image/svg+xml,'), 'the text is an SVG mask');
    assert.ok(layer()?.getAttribute('style')?.includes('DRAFT'), 'carrying the text');
  });

  test('markup in the text is escaped, not injected', async function (assert) {
    await render(<template><Watermark @text='<b>x</b> & "q"' /></template>);
    let style = decodeURIComponent(layer()?.getAttribute('style') ?? '');
    assert.ok(style.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot;'), 'escaped XML');
    assert.notOk(style.includes('<b>'), 'no raw tag');
  });

  test('an image mark tiles the image; a hostile url draws nothing', async function (assert) {
    await render(<template>
      <div class='t-a'><Watermark @image={{PIXEL}} /></div>
      <div class='t-b'><Watermark @image='javascript:alert(1)' /></div>
    </template>);
    let a = document.querySelector('.t-a [data-test-pretui-watermark-layer]') as HTMLElement;
    assert.strictEqual(a.dataset['kind'], 'image');
    assert.ok(a.getAttribute('style')?.includes('background-image: url("data:image/gif'));
    assert.notOk(document.querySelector('.t-b [data-test-pretui-watermark-layer]'), 'rejected whole, no layer');
  });

  test('no mark, no layer; opacity is clamped', async function (assert) {
    await render(<template>
      <div class='t-a'><Watermark /></div>
      <div class='t-b'><Watermark @text='DRAFT' @opacity={{0.9}} /></div>
    </template>);
    assert.notOk(document.querySelector('.t-a [data-test-pretui-watermark-layer]'));
    let b = document.querySelector('.t-b [data-test-pretui-watermark-layer]') as HTMLElement;
    assert.ok(b.getAttribute('style')?.startsWith('opacity: 0.4'), 'texture, never above 0.4');
  });

  test('an emoji at the length cap is kept whole, not split into a broken surrogate', async function (assert) {
    const LONG = 'x'.repeat(79) + '😀tail';
    await render(<template><Watermark @text={{LONG}} /></template>);
    let style = layer()?.getAttribute('style') ?? '';
    assert.ok(style.includes('mask-image'), 'the mark renders instead of throwing');
    assert.ok(decodeURIComponent(style).includes('x😀<'), 'the emoji is the 80th character, and the tail is cut');
  });
});
