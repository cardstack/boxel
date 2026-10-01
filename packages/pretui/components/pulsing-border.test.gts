// Pretui — PulsingBorder unit tests. Imports from ../texture; when
// PulsingBorder moves to its own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PulsingBorder } from './pulsing-border';
import { statusHue } from '../internal/ink';

function pb(): HTMLElement {
  return document.querySelector('[data-test-pretui-pulsing-border]') as HTMLElement;
}
function marker(): HTMLElement {
  return pb().querySelector('[data-test-pretui-pulsing-border-marker]') as HTMLElement;
}

module('Pretui | components/pulsing-border', function (hooks) {
  setupCardTest(hooks);

  test('always carries a text affordance — a pulse alone is invisible to a screen reader', async function (assert) {
    await render(<template><PulsingBorder><p data-test-body>stream</p></PulsingBorder></template>);
    assert.strictEqual(pb().dataset['variant'], 'pulse');
    assert.strictEqual(pb().dataset['active'], 'true');
    assert.strictEqual(pb().dataset['marker'], 'top-start');
    assert.strictEqual(marker().getAttribute('role'), 'status');
    assert.strictEqual(marker().textContent?.trim(), 'Live', 'the default word');
    assert.ok(marker().querySelector('[data-test-pretui-chip]'), 'the visible marker is an ink Chip, reused not redrawn');
    assert.ok(pb().querySelector('.pretui-pb-body [data-test-body]'));
    assert.strictEqual(pb().querySelector('.pretui-pb-ring')?.getAttribute('aria-hidden'), 'true');
    assert.ok(pb().querySelector('.pretui-pb-halo'), 'pulse breathes a halo');
  });

  test('derives its hue from the label so the same word is the same colour on every card', async function (assert) {
    await render(<template><PulsingBorder @label='Recording'>x</PulsingBorder></template>);
    assert.true(pb().getAttribute('style')?.includes(`--pretui-pb-hue: ${statusHue('Recording')}`));
    assert.strictEqual(marker().textContent?.trim(), 'Recording');

    await render(<template><PulsingBorder @hue='var(--chart-3)'>x</PulsingBorder></template>);
    assert.true(pb().getAttribute('style')?.includes('--pretui-pb-hue: var(--chart-3)'), 'a caller hue wins');

    await render(<template><PulsingBorder @hue='red; background: url(javascript:0)'>x</PulsingBorder></template>);
    assert.strictEqual(
      pb().getAttribute('style'),
      `--pretui-pb-hue: ${statusHue('Live')}`,
      'an unsafe hue is dropped whole and the derived one paints — the entire attribute is that one declaration',
    );
  });

  test('demotes the marker to sr-only text on request but never removes it', async function (assert) {
    await render(<template><PulsingBorder @marker={{false}}>x</PulsingBorder></template>);
    assert.strictEqual(marker().getAttribute('role'), 'status');
    assert.strictEqual(marker().textContent?.trim(), 'Live');
    assert.notOk(marker().querySelector('[data-test-pretui-chip]'), 'no chip — the surrounding UI carries the words');
    assert.true(marker().classList.contains('pretui-pb-sr'));
  });

  test('an inactive border rests, and the trail variant swaps the halo for a travelling light', async function (assert) {
    await render(<template><PulsingBorder @active={{false}} @variant='trail' @markerPlacement='bottom-end'>x</PulsingBorder></template>);
    assert.strictEqual(pb().dataset['active'], 'false');
    assert.strictEqual(pb().dataset['variant'], 'trail');
    assert.strictEqual(pb().dataset['marker'], 'bottom-end');
    assert.ok(pb().querySelector('.pretui-pb-trail'));
    assert.strictEqual(pb().querySelector('.pretui-pb-halo'), null);
  });

  test('clamps speed and thickness and takes a label block', async function (assert) {
    await render(
      <template>
        <PulsingBorder @speed={{99}} @thickness={{0.1}}>
          <:label><b data-test-custom>On air</b></:label>
          <:default>x</:default>
        </PulsingBorder>
      </template>,
    );
    assert.strictEqual(pb().style.getPropertyValue('--pretui-pb-speed'), '6', 'speed ceiling is exactly 6');
    assert.strictEqual(pb().style.getPropertyValue('--pretui-pb-thickness'), '0.5px', 'thickness floor is exactly 0.5px');
    assert.ok(marker().querySelector('[data-test-custom]'));
  });
});
