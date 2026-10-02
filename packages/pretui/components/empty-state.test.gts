// Pretui — EmptyState unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { EmptyState } from './empty-state';

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
    assert.false(el.hasAttribute('data-size'), 'the default size adds no attribute');
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

  test('EmptyState renders its default block as the message, markup included', async function (assert) {
    await render(
      <template>
        <EmptyState @title='No skills recorded'>
          Running <strong data-test-command>Extract Resume</strong> fills them from
          <code data-test-field>resumeText</code>.
        </EmptyState>
      </template>,
    );
    let msg = q('.pretui-empty-msg');
    assert.ok(msg, 'the block lands in the message slot');
    assert.strictEqual(msg.querySelector('[data-test-command]')?.tagName, 'STRONG', 'the emphasis is kept as markup');
    assert.strictEqual(msg.querySelector('[data-test-field]')?.tagName, 'CODE');
    assert.strictEqual(
      msg.textContent?.replace(/\s+/g, ' ').trim(),
      'Running Extract Resume fills them from resumeText.',
    );
    assert.strictEqual(all('.pretui-empty-msg').length, 1);
  });

  test('EmptyState renders a named default block beside the action', async function (assert) {
    await render(
      <template>
        <EmptyState @title='No lots match'>
          <:default>Try clearing the <code data-test-filter>origin</code> filter.</:default>
          <:action><button type='button' data-test-clear>Clear filters</button></:action>
        </EmptyState>
      </template>,
    );
    assert.ok(q('.pretui-empty-msg [data-test-filter]'), 'the block is the message');
    assert.ok(q('.pretui-empty-action [data-test-clear]'), 'the action still renders');
  });

  test('EmptyState prefers @message over its default block', async function (assert) {
    await render(
      <template>
        <EmptyState @title='No rows' @message='Plain text wins.'>
          <em data-test-rich>ignored</em>
        </EmptyState>
      </template>,
    );
    assert.deepEqual(texts('.pretui-empty-msg'), ['Plain text wins.'], 'one message, the string');
    assert.notOk(q('[data-test-rich]'), 'the block is not rendered as well');
  });

  test('EmptyState @size picks the compact step from the house scale', async function (assert) {
    await render(
      <template>
        <EmptyState @title='a' @size='s' data-test-s />
        <EmptyState @title='b' @size='sm' data-test-sm />
        <EmptyState @title='c' @size='small' data-test-small />
        <EmptyState @title='d' @size='xs' data-test-xs />
        <EmptyState @title='e' @size='m' data-test-m />
        <EmptyState @title='f' @size='default' data-test-default />
        <EmptyState @title='g' @size='xl' data-test-xl />
      </template>,
    );
    for (let sel of ['[data-test-s]', '[data-test-sm]', '[data-test-small]', '[data-test-xs]']) {
      assert.strictEqual(q(sel).dataset.size, 's', `${sel} lands on the compact step`);
    }
    for (let sel of ['[data-test-m]', '[data-test-default]', '[data-test-xl]']) {
      assert.false(q(sel).hasAttribute('data-size'), `${sel} keeps the page-section default`);
    }
  });
});
