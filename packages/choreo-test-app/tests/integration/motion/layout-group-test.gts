/**
 * Port of Motion's packages/framer-motion/src/components/LayoutGroup/__tests__/LayoutGroup.test.tsx (motion@bbabb00).
 * The React Consumer reads LayoutGroupContext; here the group yields the same context to its block.
 */
import { find, render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import LayoutGroup from 'glimmer-motion/layout-group';
import motion from 'glimmer-motion/motion';
import { visualElementStore } from 'motion-dom';
import { module, test } from 'qunit';

const text = (id = '1') => find(`[data-testid="${id}"]`)?.textContent;

module('Integration | motion | LayoutGroup', function (hooks) {
  setupRenderingTest(hooks);

  test("if it's the first LayoutGroup it sets the group id", async function (assert) {
    await render(
      <template>
        <LayoutGroup @id="a" as |g|><div
            data-testid="1"
          >{{g.id}}</div></LayoutGroup>
      </template>
    );
    assert.strictEqual(text(), 'a');
  });

  test("if it's a nested LayoutGroup it appends to the group id", async function (assert) {
    await render(
      <template>
        <LayoutGroup @id="a"><LayoutGroup @id="b" as |g|><div
              data-testid="1"
            >{{g.id}}</div></LayoutGroup></LayoutGroup>
      </template>
    );
    assert.strictEqual(text(), 'a-b');
  });

  test("if the value of id is undefined, it doesn't change the group id", async function (assert) {
    await render(
      <template>
        <LayoutGroup @id="a"><LayoutGroup @id={{undefined}} as |g|><div
              data-testid="1"
            >{{g.id}}</div></LayoutGroup></LayoutGroup>
      </template>
    );
    assert.strictEqual(text(), 'a');
  });

  test('if the parent group id is undefined, child LayoutGroups still append the group id', async function (assert) {
    await render(
      <template>
        <LayoutGroup @id="a"><LayoutGroup @id={{undefined}}><LayoutGroup
              @id="b"
              as |g|
            ><div
                data-testid="1"
              >{{g.id}}</div></LayoutGroup></LayoutGroup></LayoutGroup>
      </template>
    );
    assert.strictEqual(text(), 'a-b');
  });

  // binding contract beyond the React suite: the group id namespaces layoutIds, as useLayoutId does
  test('a group id namespaces the layoutId of motion elements beneath it', async function (assert) {
    await render(
      <template>
        <LayoutGroup @id="tabs"><div
            id="m"
            {{motion layoutId="underline"}}
          ></div></LayoutGroup><div
          id="n"
          {{motion layoutId="underline"}}
        ></div>
      </template>
    );
    const idOf = (id: string) =>
      (visualElementStore.get(find(`#${id}`)!) as any)?.projection?.options
        ?.layoutId;
    assert.strictEqual(idOf('m'), 'tabs-underline');
    assert.strictEqual(idOf('n'), 'underline');
  });
});
