// Pretui — Grid unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Grid } from './grid';

interface Tile { name: string }
const TILES: Tile[] = [{ name: 'Wuyi' }, { name: 'Anxi' }, { name: 'Fuding' }];
const nameOf = (t: Tile) => t.name;

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-grid]') as HTMLElement;
}

module('Pretui | components/grid', function (hooks) {
  setupCardTest(hooks);

  test('wraps boxel-ui GridContainer and yields each item in the caller row type', async function (assert) {
    await render(
      <template>
        <Grid @items={{TILES}} as |item|>
          {{#if item}}<span data-test-tile>{{nameOf item}}</span>{{/if}}
        </Grid>
      </template>,
    );
    assert.ok(root());
    assert.deepEqual(Array.from(root().querySelectorAll('[data-test-tile]')).map((t) => t.textContent), ['Wuyi', 'Anxi', 'Fuding']);
  });

  test('renders an empty grid for no items (the layout knobs pass through but leave no DOM trace)', async function (assert) {
    // @viewFormat / @fullWidthItem are forwarded to boxel-ui's GridContainer,
    // which renders the same element, class and (empty) style either way, so
    // forwarding is unobservable from outside the engine in this harness.
    const NONE: Tile[] = [];
    // boxel-ui's GridContainer yields its block once with NO item when the
    // list is empty (its block signature is `[item, Container] | []`), so a
    // caller block must guard — the same guard a real tile would carry.
    await render(<template><Grid @items={{NONE}} @viewFormat='list' @fullWidthItem={{true}} as |item|>{{#if item}}<span data-test-tile>{{nameOf item}}</span>{{/if}}</Grid></template>);
    assert.ok(root());
    assert.strictEqual(root().querySelectorAll('[data-test-tile]').length, 0);
  });
});
