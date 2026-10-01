// Pretui — Accordion unit tests. The wrapper is three lines (hook,
// ...attributes, @displayContainer pass-through, {{yield A}}); every ARIA
// attribute asserted in the first test is emitted by boxel-ui's AccordionItem.
// It is kept here deliberately as a downstream integration guard, since
// boxel-ui's own suite covers aria-expanded and aria-hidden but not region,
// labelledby, controls or inert.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Accordion } from './accordion';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-accordion]') as HTMLElement;
}
function triggers(): HTMLButtonElement[] {
  return Array.from(root().querySelectorAll('button[aria-expanded]')) as HTMLButtonElement[];
}

module('Pretui | components/accordion', function (hooks) {
  setupCardTest(hooks);

  test('integration guard over boxel-ui: the yielded Item exposes open state as aria-expanded, a labelled region, and inert', async function (assert) {
    class State {
      @tracked open = 'a';
    }
    let state = new State();
    const isOpen = (id: string) => state.open === id;
    const toggle = (id: string) => () => (state.open = state.open === id ? '' : id);
    await render(
      <template>
        <Accordion as |A|>
          <A.Item @id='a' @isOpen={{isOpen 'a'}} @onClick={{toggle 'a'}}>
            <:title>Cupping notes</:title>
            <:content><p data-test-a>Floral</p></:content>
          </A.Item>
          <A.Item @id='b' @isOpen={{isOpen 'b'}} @onClick={{toggle 'b'}}>
            <:title>Storage</:title>
            <:content><p data-test-b>Cool, dry</p></:content>
          </A.Item>
        </Accordion>
      </template>,
    );
    assert.ok(root());
    assert.deepEqual(triggers().map((t) => t.textContent?.trim()), ['Cupping notes', 'Storage']);
    assert.deepEqual(triggers().map((t) => t.getAttribute('aria-expanded')), ['true', 'false']);
    let contents = Array.from(root().querySelectorAll('[role="region"]')) as HTMLElement[];
    assert.deepEqual(contents.map((c) => c.dataset['state']), ['open', 'closed']);
    assert.strictEqual(contents.length, 2, 'one region per item');
    assert.strictEqual(contents[1]?.getAttribute('aria-labelledby'), triggers()[1]?.id, 'each region is named by its own trigger');
    assert.strictEqual(document.getElementById(triggers()[1]?.getAttribute('aria-controls') ?? ''), contents[1], 'and the trigger controls its own region');
    assert.false(contents[0]?.inert);
    assert.true(contents[1]?.inert, 'a closed panel is out of the tab order');
    assert.ok(root().querySelector('[data-test-b]'), 'closed content stays in the DOM');

    await click(triggers()[1] as HTMLElement);
    assert.deepEqual(triggers().map((t) => t.getAttribute('aria-expanded')), ['false', 'true'], 'the caller owns which item is open');
  });

  test('the wrapper forwards @displayContainer and ...attributes', async function (assert) {
    const noop = () => {};
    await render(<template><Accordion @displayContainer={{true}} data-test-extra='1' as |A|><A.Item @id='x' @isOpen={{false}} @onClick={{noop}}><:title>x</:title><:content>y</:content></A.Item></Accordion></template>);
    assert.strictEqual(root().dataset['testExtra'], '1', '...attributes land on the wrapper root');
    assert.ok(root().querySelector('.boxel-accordion.boxel-accordion-container'));
    await render(<template><Accordion as |A|><A.Item @id='x' @isOpen={{false}} @onClick={{noop}}><:title>x</:title><:content>y</:content></A.Item></Accordion></template>);
    assert.ok(root().querySelector('.boxel-accordion'));
    assert.strictEqual(root().querySelector('.boxel-accordion-container'), null);
  });
});
