// Pretui — Image unit tests: the reserved ratio, alt handling, the load
// state, the fallback source, the failure face and the preview. No test
// touches the network: a good image is a data: URI, a bad one is a data: URI
// the decoder rejects.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { clearRender, click, render, settled, waitUntil } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Image } from './image';
import type { ImageStatus } from './image';

const GOOD = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const BAD = 'data:image/png;base64,AAAA';
const ALSO_BAD = 'data:image/png;base64,AAAB';
// w descriptors scale naturalWidth to the drawn width, so a 1px image must
// claim a 1–2px width or it reads as 0 wide, which Image treats as broken
const GOOD_SET = `${GOOD} 1w, ${GOOD} 2w`;
const BAD_SET = `${BAD} 480w`;

class Src {
  @tracked src = BAD;
}

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-image]') as HTMLElement;
}
function img(): HTMLImageElement | null {
  return document.querySelector('[data-test-pretui-image-img]');
}
async function statusIs(status: ImageStatus) {
  await waitUntil(() => root()?.dataset['status'] === status, { timeout: 2000 });
}

module('Pretui | components/image', function (hooks) {
  setupCardTest(hooks);

  test('it reserves the ratio from @width / @height, then 4 / 3, and @ratio wins', async function (assert) {
    await render(<template>
      <div class='t-a'><Image @src={{GOOD}} @alt='A' @width={{640}} @height={{480}} /></div>
      <div class='t-b'><Image @src={{GOOD}} @alt='B' /></div>
      <div class='t-c'><Image @src={{GOOD}} @alt='C' @ratio='16 / 9' @width={{640}} @height={{480}} /></div>
    </template>);
    let ratio = (sel: string) =>
      (document.querySelector(`${sel} [data-test-pretui-image]`) as HTMLElement).style
        .getPropertyValue('--pretui-aspect-ratio')
        .trim();
    assert.strictEqual(ratio('.t-a'), '640 / 480');
    assert.strictEqual(ratio('.t-b'), '4 / 3');
    assert.strictEqual(ratio('.t-c'), '16 / 9');
  });

  test('a loaded image is a real img with its alt, and attributes land on the frame', async function (assert) {
    let seen: ImageStatus[] = [];
    let track = (s: ImageStatus) => seen.push(s);
    await render(<template>
      <Image @src={{GOOD}} @alt='Estate at dawn' @onStatusChange={{track}} data-kind='hero' />
    </template>);
    await statusIs('loaded');
    assert.strictEqual(root().getAttribute('data-kind'), 'hero');
    assert.strictEqual(img()?.getAttribute('alt'), 'Estate at dawn');
    assert.strictEqual(img()?.getAttribute('loading'), 'lazy', 'lazy by default');
    assert.deepEqual(seen, ['loaded']);
  });

  test('an empty alt stays empty: a decorative image', async function (assert) {
    await render(<template><Image @src={{GOOD}} @alt='' /></template>);
    assert.strictEqual(img()?.getAttribute('alt'), '');
  });

  test('a failed source tries @fallback once, then shows the failure face with the alt text', async function (assert) {
    let seen: ImageStatus[] = [];
    let track = (s: ImageStatus) => seen.push(s);
    await render(<template>
      <Image @src={{BAD}} @fallback={{ALSO_BAD}} @alt='Lot 7 label' @onStatusChange={{track}} />
    </template>);
    await statusIs('error');
    assert.notOk(img(), 'no broken img is left in the page');
    let face = document.querySelector('[data-test-pretui-image-fallback]');
    assert.ok(face, 'the failure face shows');
    assert.strictEqual(face?.querySelector('[role="img"]')?.getAttribute('aria-label'), 'Lot 7 label', 'the alt still names it');
    assert.deepEqual(seen, ['loading', 'error'], 'the fallback was tried, then it failed');
  });

  test('a working @fallback takes over from a failed @src', async function (assert) {
    await render(<template><Image @src={{BAD}} @fallback={{GOOD}} @alt='Lot 7' /></template>);
    await statusIs('loaded');
    assert.strictEqual(img()?.getAttribute('src'), GOOD);
  });

  test('@srcset and @sizes reach the img, and the set is dropped once @fallback takes over', async function (assert) {
    await render(<template>
      <div class='t-a'><Image @src={{GOOD}} @srcset={{GOOD_SET}} @sizes='(max-width: 600px) 100vw, 640px' @alt='A' /></div>
      <div class='t-b'><Image @src={{GOOD}} @sizes='640px' @alt='B' /></div>
    </template>);
    let a = document.querySelector('.t-a img') as HTMLImageElement;
    assert.strictEqual(a.getAttribute('srcset'), GOOD_SET);
    assert.strictEqual(a.getAttribute('sizes'), '(max-width: 600px) 100vw, 640px');
    let b = document.querySelector('.t-b img') as HTMLImageElement;
    assert.false(b.hasAttribute('sizes'), 'sizes without a set means nothing, so it is left off');

    await clearRender();
    await render(<template><Image @src={{BAD}} @srcset={{BAD_SET}} @fallback={{GOOD}} @alt='Lot 7' /></template>);
    // the bad set fails like the bad src; the fallback must not inherit it
    await waitUntil(() => img()?.getAttribute('src') === GOOD, { timeout: 2000 });
    assert.false(img()!.hasAttribute('srcset'), 'the fallback is never shadowed by the failed set');
  });

  test('a fallback identical to the source is not retried', async function (assert) {
    await render(<template><Image @src={{BAD}} @fallback={{BAD}} @alt='Lot 7' /></template>);
    await statusIs('error');
    assert.ok(document.querySelector('[data-test-pretui-image-fallback]'));
  });

  test('the fallback block replaces the default failure face', async function (assert) {
    await render(<template>
      <Image @src={{BAD}} @alt='Lot 7'>
        <:fallback><span class='t-custom'>No photo yet</span></:fallback>
      </Image>
    </template>);
    await statusIs('error');
    assert.ok(document.querySelector('[data-test-pretui-image-fallback] .t-custom'));
  });

  test('no @src is a failure, not an empty img', async function (assert) {
    await render(<template><Image @alt='Missing' /></template>);
    assert.strictEqual(root().dataset['status'], 'error');
    assert.notOk(img());
  });

  test('a new @src starts over', async function (assert) {
    let state = new Src();
    await render(<template><Image @src={{state.src}} @alt='Lot 7' /></template>);
    await statusIs('error');
    state.src = GOOD;
    await settled();
    await statusIs('loaded');
    assert.strictEqual(img()?.getAttribute('src'), GOOD);
  });

  test('@preview makes the image a named button that opens it in a dialog', async function (assert) {
    await render(<template><Image @src={{GOOD}} @alt='Estate at dawn' @preview={{true}} /></template>);
    await statusIs('loaded');
    let trigger = document.querySelector('[data-test-pretui-image-preview-trigger]') as HTMLButtonElement;
    assert.strictEqual(trigger.getAttribute('aria-label'), 'View larger: Estate at dawn');
    assert.strictEqual(trigger.getAttribute('aria-haspopup'), 'dialog');
    assert.strictEqual(img()?.getAttribute('alt'), '', 'the button carries the name, so the inner img does not repeat it');
    await click(trigger);
    let dialog = document.querySelector('[data-test-pretui-image-preview]') as HTMLDialogElement;
    assert.true(dialog.open, 'the preview dialog is open');
    assert.strictEqual(dialog.querySelector('img')?.getAttribute('alt'), 'Estate at dawn');
  });

  test('the preview button is disabled until the image has loaded', async function (assert) {
    await render(<template><Image @src={{BAD}} @fallback={{GOOD}} @alt='Lot 7' @preview={{true}} /></template>);
    let trigger = () => document.querySelector('[data-test-pretui-image-preview-trigger]') as HTMLButtonElement;
    await statusIs('loaded');
    assert.false(trigger().disabled, 'enabled once something loaded');
  });
});
