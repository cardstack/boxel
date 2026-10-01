// Pretui — Marquee unit tests. Imports from ../structure-scenes; when Marquee moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied) — so motion is asserted
// as the custom properties and structure the CSS animates from, never as
// movement.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Marquee } from './marquee';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-marquee]') as HTMLElement;
}

module('Pretui | components/marquee', function (hooks) {
  setupCardTest(hooks);

  test('renders the strip twice for a seamless loop, the copy hidden from assistive tech', async function (assert) {
    await render(<template><Marquee><span data-test-item>Spring lots</span></Marquee></template>);
    assert.strictEqual(root().dataset['direction'], 'left');
    assert.strictEqual(root().dataset['pauseOnHover'], undefined);
    let copies = Array.from(root().querySelectorAll('.pretui-marquee-copy')) as HTMLElement[];
    assert.strictEqual(copies.length, 2);
    assert.strictEqual(copies[0]?.getAttribute('aria-hidden'), null, 'the first copy is the content');
    assert.strictEqual(copies[1]?.getAttribute('aria-hidden'), 'true', 'the second exists only for the loop');
    assert.strictEqual(root().querySelectorAll('[data-test-item]').length, 2);
  });

  test('derives the loop duration from the measured width and speed, with a floor', async function (assert) {
    await render(<template><Marquee @speed={{120}} @direction='right' @pauseOnHover={{true}}>Spring lots</Marquee></template>);
    let track = root().querySelector('.pretui-marquee-track') as HTMLElement;
    let duration = track.style.getPropertyValue('--pretui-marquee-duration');
    assert.strictEqual(
      duration,
      `${Math.max(0.5, track.scrollWidth / 2 / 120).toFixed(2)}s`,
      'one copy (half the track) divided by the px/s speed — measured, not a constant',
    );
    assert.strictEqual(root().dataset['direction'], 'right');
    assert.strictEqual(root().dataset['pauseOnHover'], 'true');

    await render(<template><Marquee @speed={{60}}>Spring lots</Marquee></template>);
    let slow = parseFloat((root().querySelector('.pretui-marquee-track') as HTMLElement).style.getPropertyValue('--pretui-marquee-duration'));
    assert.true(Math.abs(slow / parseFloat(duration) - 2) < 0.02, 'half the speed, twice the duration');

    await render(<template><Marquee @speed={{100000}}>Spring lots</Marquee></template>);
    assert.strictEqual((root().querySelector('.pretui-marquee-track') as HTMLElement).style.getPropertyValue('--pretui-marquee-duration'), '0.50s', 'the half-second floor');
  });
});
