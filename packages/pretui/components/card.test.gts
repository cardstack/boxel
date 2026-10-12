// Pretui — Card unit tests, for the select control. What is asserted is the
// markup contract: one native button that is a sibling of the content, its
// name and pressed state, and that the card's own controls keep their
// clicks. The pointer-events stacking lives in `<style scoped>`, which is
// inert here.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, click, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { Card } from './card';

class Holder {
  @tracked selected = false;
  selects = 0;
  inner = 0;
  toggle = () => {
    this.selects++;
    this.selected = !this.selected;
  };
  press = () => {
    this.inner++;
  };
}

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/card', function (hooks) {
  setupCardTest(hooks);

  test('Card without @onSelect renders no select control', async function (assert) {
    await render(
      <template>
        <Card @title='Lot B-201' @selected={{true}}>body</Card>
      </template>,
    );
    assert.dom('[data-test-pretui-card-select]').doesNotExist();
    assert.strictEqual(
      q('[data-test-pretui-card]').dataset['selected'],
      'true',
      '@selected alone still reflects',
    );
    assert.strictEqual(
      q('[data-test-pretui-card]').dataset['selectable'],
      'false',
    );
  });

  test('@onSelect renders one native button beside the content, pressed state following @selected', async function (assert) {
    let h = new Holder();
    await render(
      <template>
        <Card
          @title='Lot B-201'
          @selected={{h.selected}}
          @onSelect={{h.toggle}}
        >body</Card>
      </template>,
    );
    let root = q('[data-test-pretui-card]');
    let button = q('[data-test-pretui-card-select]');
    assert.strictEqual(root.tagName, 'SECTION', 'the root stays a section');
    assert.false(root.hasAttribute('role'), 'no role on the root');
    assert.false(root.hasAttribute('tabindex'), 'no tabindex on the root');
    assert.strictEqual(button.tagName, 'BUTTON');
    assert.strictEqual(button.getAttribute('type'), 'button');
    assert.strictEqual(
      button.parentElement,
      root,
      'a direct child of the section',
    );
    assert.strictEqual(
      button.children.length,
      0,
      'it wraps none of the content',
    );
    assert.strictEqual(button.getAttribute('aria-pressed'), 'false');

    await click(button);
    assert.strictEqual(h.selects, 1, '@onSelect fired');
    assert.strictEqual(
      button.getAttribute('aria-pressed'),
      'true',
      'aria-pressed follows @selected',
    );
    assert.strictEqual(root.dataset['selected'], 'true');

    await click(button);
    assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
  });

  test('the select control is named by the title, or by @selectLabel', async function (assert) {
    let h = new Holder();
    class State {
      @tracked label: string | undefined = undefined;
    }
    let state = new State();
    await render(
      <template>
        <Card
          @title='Lot B-201'
          @onSelect={{h.toggle}}
          @selectLabel={{state.label}}
        >body</Card>
      </template>,
    );
    let button = q('[data-test-pretui-card-select]');
    let title = q('.pretui-card-title');
    assert.strictEqual(
      button.getAttribute('aria-labelledby'),
      title.id,
      'labelled by the generated title',
    );
    assert.false(button.hasAttribute('aria-label'));

    state.label = 'Filter the inbox to lot B-201';
    await settled();
    assert.strictEqual(
      button.getAttribute('aria-label'),
      'Filter the inbox to lot B-201',
      '@selectLabel names it',
    );
    assert.false(
      button.hasAttribute('aria-labelledby'),
      'and replaces the title reference',
    );
  });

  test("the card's own link and button keep their clicks", async function (assert) {
    let h = new Holder();
    let follow = (event: Event) => event.preventDefault();
    await render(
      <template>
        <Card @title='Lot B-201' @onSelect={{h.toggle}}>
          <:action><button
              type='button'
              class='inner-button'
              {{on 'click' h.press}}
            >Edit</button></:action>
          <:default><a
              href='#lot'
              class='inner-link'
              {{on 'click' follow}}
            >Open</a></:default>
        </Card>
      </template>,
    );
    await click('.inner-button');
    assert.strictEqual(h.inner, 1, 'the inner button handled its click');
    await click('.inner-link');
    assert.strictEqual(
      h.selects,
      0,
      '@onSelect never fired from the inner controls',
    );
    assert
      .dom('[data-test-pretui-card-select]')
      .hasAttribute('aria-pressed', 'false');
  });
});
