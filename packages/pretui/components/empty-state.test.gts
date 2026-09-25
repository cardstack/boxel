// Pretui — EmptyState unit tests. Imports from ../structure; when EmptyState
// moves to its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { EmptyState } from '../structure';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function texts(sel: string): (string | undefined)[] {
  return all(sel).map((e) => e.textContent?.trim());
}

module('Pretui | components/empty-state', function (hooks) {
  setupCardTest(hooks);

  test('EmptyState carries the texture by default and renders no empty slots', async function (assert) {
    await render(<template><EmptyState @title='No suppliers yet' /></template>);
    let el = q('[data-test-pretui-empty]');
    assert.strictEqual(el.querySelector('.pretui-empty-title')?.textContent?.trim(), 'No suppliers yet');
    assert.ok(el.querySelector('.pretui-empty-texture'), 'texture is on by default (Law 6)');
    assert.notOk(el.querySelector('.pretui-empty-msg'));
    assert.notOk(el.querySelector('.pretui-empty-action'));
  });

  test('EmptyState drops the texture on request', async function (assert) {
    await render(<template><EmptyState @title='Nothing here' @texture={{false}} /></template>);
    assert.notOk(q('.pretui-empty-texture'));
  });

  test('EmptyState gives both ways in equal billing with a separator between', async function (assert) {
    await render(
      <template>
        <EmptyState @title='No batches' @message='Start one, or bring one in.'>
          <:action><button type='button' data-test-new>Start blank</button></:action>
          <:altAction><button type='button' data-test-import>Import CSV</button></:altAction>
        </EmptyState>
      </template>,
    );
    assert.strictEqual(q('.pretui-empty-msg').textContent?.trim(), 'Start one, or bring one in.');
    assert.deepEqual(texts('.pretui-empty-paths > *'), ['Start blank', 'or', 'Import CSV']);
    let sep = q('.pretui-empty-sep');
    assert.strictEqual(sep.getAttribute('aria-hidden'), 'true', 'the "or" is visual punctuation');
  });

  test('EmptyState takes @separator and defaults the wording to "or"', async function (assert) {
    await render(
      <template>
        <EmptyState @title='Connect' @separator='alternatively'>
          <:action>Sign in</:action>
          <:altAction>Paste a token</:altAction>
        </EmptyState>
      </template>,
    );
    assert.strictEqual(q('.pretui-empty-sep').textContent?.trim(), 'alternatively', 'the caller wording');
    await render(
      <template>
        <EmptyState @title='Connect'>
          <:action>Sign in</:action>
          <:altAction>Paste a token</:altAction>
        </EmptyState>
      </template>,
    );
    assert.strictEqual(q('.pretui-empty-sep').textContent?.trim(), 'or', 'the default wording');
  });

  test('EmptyState with only one action skips the paths row', async function (assert) {
    await render(
      <template>
        <EmptyState @title='No rows'>
          <:action><button type='button' data-test-new>Add</button></:action>
        </EmptyState>
      </template>,
    );
    assert.notOk(q('.pretui-empty-paths'), 'no separator with nothing to separate');
    assert.ok(q('.pretui-empty-action [data-test-new]'));
  });
});
