// Pretui — Recommendation unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Recommendation } from './recommendation';
import type { RecommendationOption } from './recommendation';

const OPTIONS: RecommendationOption[] = [
  { key: 'hold', body: 'Hold the price; the market is thin this week.', short: 'Hold the price', level: 3, label: 'High confidence', cta: 'Hold' },
  { key: 'cut', body: 'Cut by 5% to clear the spring lots.', short: 'Cut by 5%', level: 2, label: 'Medium confidence' },
  { key: 'raise', body: 'Raise by 3% on scarcity.', short: 'Raise by 3%', level: 1, label: 'Low confidence' },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-recommendation]') as HTMLElement;
}
function accept(): HTMLButtonElement {
  return root().querySelector('[data-test-pretui-recommendation-accept]') as HTMLButtonElement;
}
function drawerBtn(): HTMLButtonElement | null {
  return root().querySelector('[data-test-pretui-recommendation-drawer]');
}
function alts(): HTMLButtonElement[] {
  return Array.from(root().querySelectorAll('[data-test-pretui-recommendation-alt]')) as HTMLButtonElement[];
}

module('Pretui | components/recommendation', function (hooks) {
  setupCardTest(hooks);

  test('leads with the best option, its confidence as a labelled Meter, and the alternatives one press away', async function (assert) {
    await render(<template><Recommendation @question='What should the price do?' @options={{OPTIONS}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-reco-question')?.textContent?.trim(), 'What should the price do?');
    assert.strictEqual(root().querySelector('.pretui-reco-body')?.textContent?.trim(), 'Hold the price; the market is thin this week.');
    let meter = root().querySelector('.pretui-reco-foot [data-test-pretui-meter]') as HTMLElement;
    assert.strictEqual(meter.getAttribute('aria-valuenow'), '3');
    assert.strictEqual(meter.getAttribute('aria-label'), 'High confidence', 'the confidence word is always beside the segments');
    assert.strictEqual(accept().textContent?.trim(), 'Hold', 'the option names its own CTA');
    assert.strictEqual(drawerBtn()?.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(alts().length, 2, 'rendered but closed — one keystroke away rather than hidden');
    assert.true((root().querySelector('[data-test-pretui-disclosure]') as HTMLElement).inert);
    assert.strictEqual(root().querySelector('[role="status"]')?.textContent?.trim(), 'Showing: Hold the price — confidence High confidence');
  });

  test('switching to an alternative swaps the body, closes the drawer, announces, and reports', async function (assert) {
    let selected: string[] = [];
    const onSelect = (o: RecommendationOption) => selected.push(o.key);
    await render(<template><Recommendation @question='q' @options={{OPTIONS}} @onSelect={{onSelect}} /></template>);
    await click(drawerBtn() as HTMLElement);
    assert.strictEqual(drawerBtn()?.getAttribute('aria-expanded'), 'true');
    await click(alts()[0] as HTMLElement);
    assert.deepEqual(selected, ['cut']);
    assert.strictEqual(root().querySelector('.pretui-reco-body')?.textContent?.trim(), 'Cut by 5% to clear the spring lots.');
    assert.strictEqual(root().querySelector('[role="status"]')?.textContent?.trim(), 'Showing: Cut by 5% — confidence Medium confidence', 'a sighted reader saw a cross-fade; everyone else hears this');
    assert.strictEqual(drawerBtn()?.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(accept().textContent?.trim(), 'Accept', 'no cta on this option, so the default');
    assert.deepEqual(alts().map((a) => a.textContent?.replace(/\s+/g, ' ').trim()).map((t) => t?.includes('Hold the price')), [true, false], 'the former favourite is now an alternative');
  });

  test('accepting reports the active option and settles the button', async function (assert) {
    let accepted: string[] = [];
    const onAccept = (o: RecommendationOption) => accepted.push(o.key);
    await render(<template><Recommendation @question='q' @options={{OPTIONS}} @onAccept={{onAccept}} @acceptedLabel='Locked in' /></template>);
    await click(accept());
    assert.deepEqual(accepted, ['hold']);
    assert.strictEqual(root().dataset['accepted'], 'true');
    assert.strictEqual(accept().textContent?.trim(), 'Locked in');
  });

  test('a controlled selection holds still and reports; a lone option has no drawer', async function (assert) {
    let selected: string[] = [];
    const onSelect = (o: RecommendationOption) => selected.push(o.key);
    await render(<template><Recommendation @question='q' @options={{OPTIONS}} @selectedKey='raise' @onSelect={{onSelect}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-reco-body')?.textContent?.trim(), 'Raise by 3% on scarcity.');
    await click(drawerBtn() as HTMLElement);
    await click(alts()[0] as HTMLElement);
    assert.deepEqual(selected, ['hold']);
    assert.strictEqual(root().querySelector('.pretui-reco-body')?.textContent?.trim(), 'Raise by 3% on scarcity.', 'the owner decides');

    const ONE: RecommendationOption[] = [OPTIONS[0] as RecommendationOption];
    await render(<template><Recommendation @question='q' @options={{ONE}} /></template>);
    assert.strictEqual(drawerBtn(), null);
  });

  test('a body block replaces the option text', async function (assert) {
    await render(
      <template>
        <Recommendation @question='q' @options={{OPTIONS}}>
          <:body as |option|><b data-test-rich>{{option.short}}!</b></:body>
        </Recommendation>
      </template>,
    );
    assert.strictEqual(root().querySelector('.pretui-reco-body [data-test-rich]')?.textContent, 'Hold the price!');
  });
});
