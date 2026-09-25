// Pretui — ScrollProgress unit tests. Imports from ../motion-core; when ScrollProgress moves to its
// own file only the import path changes.
//
// No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied) — so motion is asserted
// as the custom properties and structure the CSS animates from, never as
// movement.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ScrollProgress } from './scroll-progress';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-scroll-progress]') as HTMLElement;
}

module('Pretui | components/scroll-progress', function (hooks) {
  setupCardTest(hooks);

  test('is decorative by default: tracks the page, shows a track, and is hidden from assistive tech', async function (assert) {
    await render(<template><ScrollProgress /></template>);
    assert.strictEqual(root().dataset['source'], 'page');
    assert.strictEqual(root().dataset['affix'], 'none');
    assert.strictEqual(root().dataset['track'], 'true', 'the track is what makes it legible in a still frame');
    assert.strictEqual(root().getAttribute('aria-hidden'), 'true');
    assert.strictEqual(root().getAttribute('role'), null);
    assert.ok(root().querySelector('.pretui-scrollprogress-fill'));
    // Precondition: on a Chromium with scroll-driven animations the decorative
    // modifier returns before writing anything, so the style stays empty. On a
    // runner without them this and the thickness assertion below would fail
    // for a reason unrelated to the component.
    assert.true(CSS.supports('animation-timeline', 'scroll()'), 'this runner has scroll-driven animations');
    assert.strictEqual(root().getAttribute('style'), '');
  });

  test('announce turns it into a labelled progressbar', async function (assert) {
    await render(<template><ScrollProgress @announce={{true}} @label='Reading progress' /></template>);
    assert.strictEqual(root().getAttribute('role'), 'progressbar');
    assert.strictEqual(root().getAttribute('aria-label'), 'Reading progress');
    assert.strictEqual(root().getAttribute('aria-valuemin'), '0');
    assert.strictEqual(root().getAttribute('aria-valuemax'), '100');
    assert.strictEqual(root().getAttribute('aria-valuenow'), '0', 'the listener path writes the live value — a progressbar without valuenow is invalid');
    assert.strictEqual(root().getAttribute('data-js'), 'true', 'and marks that the JS path took over from the CSS timeline');
    assert.strictEqual(root().getAttribute('aria-hidden'), null);
  });

  test('takes source, affix, track and thickness', async function (assert) {
    await render(<template><ScrollProgress @source='nearest' @affix='top' @track={{false}} @thickness={{3}} /></template>);
    assert.strictEqual(root().dataset['source'], 'nearest');
    assert.strictEqual(root().dataset['affix'], 'top');
    assert.strictEqual(root().dataset['track'], 'false');
    assert.strictEqual(root().getAttribute('style'), '--pretui-scrollprogress-thickness: 3px');
  });
});
