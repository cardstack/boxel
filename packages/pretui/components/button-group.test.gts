// Pretui — ButtonGroup unit tests. Imports from ./composites; when ButtonGroup moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ButtonGroup } from './composites';
import { Button } from './button';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/button-group', function (hooks) {
  setupCardTest(hooks);

  test('ButtonGroup is a named group that hands its recipe to every child', async function (assert) {
    await render(
      <template>
        <ButtonGroup @label='Row actions' @tone='neutral' @appearance='outlined' @size='s'>
          <Button>Open</Button>
          <Button>Duplicate</Button>
        </ButtonGroup>
      </template>,
    );
    let group = q('[data-test-pretui-button-group]');
    assert.strictEqual(group.getAttribute('role'), 'group');
    assert.strictEqual(group.getAttribute('aria-label'), 'Row actions');
    assert.strictEqual(group.getAttribute('aria-orientation'), 'horizontal', 'horizontal by default');
    assert.strictEqual(group.dataset['tone'], 'neutral');
    assert.strictEqual(group.dataset['appearance'], 'outlined');
    assert.strictEqual(group.dataset['size'], 's');
    assert.strictEqual(group.querySelectorAll('[data-test-pretui-button]').length, 2);
  });

  test('ButtonGroup declares its orientation in both channels', async function (assert) {
    await render(<template><ButtonGroup @orientation='vertical'><Button>One</Button></ButtonGroup></template>);
    let group = q('[data-test-pretui-button-group]');
    assert.strictEqual(group.getAttribute('aria-orientation'), 'vertical', 'so the arrows are announced correctly');
    assert.strictEqual(group.dataset['orientation'], 'vertical', 'and the CSS has the same fact to style from');
  });

  test('ButtonGroup leaves the recipe attributes off when nothing was asked for', async function (assert) {
    await render(<template><ButtonGroup><Button>One</Button></ButtonGroup></template>);
    let group = q('[data-test-pretui-button-group]');
    assert.strictEqual(group.dataset['tone'], undefined, 'so a child Button keeps its own tone');
    assert.strictEqual(group.dataset['appearance'], undefined);
  });
});
