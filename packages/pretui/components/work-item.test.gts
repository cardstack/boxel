// Pretui — WorkItem unit tests. Imports from ../agentic; when WorkItem moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { WorkItem } from './work-item';

function item(): HTMLElement {
  return document.querySelector('[data-test-pretui-work-item]') as HTMLElement;
}
function items(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-test-pretui-work-item]')) as HTMLElement[];
}

module('Pretui | components/work-item', function (hooks) {
  setupCardTest(hooks);

  test('defaults to a pending step with the queued status word', async function (assert) {
    await render(<template><WorkItem @title='Index the realm' /></template>);
    assert.strictEqual(item().dataset['tier'], 'step');
    assert.strictEqual(item().dataset['state'], 'pending');
    assert.strictEqual(item().dataset['attention'], undefined);
    assert.strictEqual(item().querySelector('.pretui-workitem-title')?.textContent?.trim(), 'Index the realm');
    assert.strictEqual(item().querySelector('.pretui-workitem-status')?.textContent?.trim(), 'queued', 'a state always has a word, not only a hue');
    assert.strictEqual((item().querySelector('.pretui-disc') as HTMLElement).dataset['tone'], 'idle');
    assert.strictEqual(item().querySelector('.pretui-workitem-body'), null, 'no body without progress or activity');
  });

  test('maps each state family to a tone, glyph and default status word', async function (assert) {
    await render(
      <template>
        <WorkItem @title='a' @state='running' />
        <WorkItem @title='b' @state='awaiting-approval' />
        <WorkItem @title='c' @state='completed' />
        <WorkItem @title='d' @state='failed' />
        <WorkItem @title='e' @state='canceled' />
      </template>,
    );
    assert.deepEqual(
      items().map((i) => (i.querySelector('.pretui-disc') as HTMLElement).dataset['tone']),
      ['running', 'attention', 'done', 'failed', 'idle'],
    );
    assert.ok(items()[0]?.querySelector('[data-test-pretui-spinner]'), 'running spins instead of a glyph');
    assert.deepEqual(items().slice(1).map((i) => i.querySelector('.pretui-disc')?.textContent?.trim()), ['●', '✓', '✕', '·']);
    assert.deepEqual(
      items().map((i) => i.querySelector('.pretui-workitem-status')?.textContent?.trim()),
      ['running…', '● needs you', 'done', 'failed', 'canceled'],
    );
    assert.strictEqual(items()[1]?.dataset['attention'], 'true', 'only the attention family lights the card');
  });

  test('an unknown state degrades to idle and prints itself as the status', async function (assert) {
    await render(<template><WorkItem @title='x' @state='daydreaming' /></template>);
    assert.strictEqual((item().querySelector('.pretui-disc') as HTMLElement).dataset['tone'], 'idle');
    assert.strictEqual(item().querySelector('.pretui-workitem-status')?.textContent?.trim(), 'daydreaming', 'never a blank status');
  });

  test('a caller status, verb and tier override the derivations', async function (assert) {
    await render(<template><WorkItem @title='x' @tier='run' @verb='INDEX' @state='running' @status='3 of 9 realms' /></template>);
    assert.strictEqual(item().dataset['tier'], 'run');
    assert.strictEqual(item().querySelector('.pretui-verb')?.textContent?.trim(), 'INDEX');
    assert.strictEqual(item().querySelector('.pretui-workitem-status')?.textContent?.trim(), '3 of 9 realms');
  });

  test('progress grows a body with a stepped or continuous bar and its count', async function (assert) {
    await render(<template><WorkItem @title='x' @state='running' @progressValue={{3}} @progressMax={{9}} @activity='Reindexing lots…' /></template>);
    let body = item().querySelector('.pretui-workitem-body') as HTMLElement;
    assert.ok(body);
    assert.ok(body.querySelector('[data-test-pretui-progress]'));
    assert.strictEqual(body.querySelector('.pretui-progress-count')?.textContent?.trim(), '3 / 9', 'the count is derived when none is given');
    assert.strictEqual(body.querySelector('.pretui-activity')?.textContent?.trim(), 'Reindexing lots…');

    await render(<template><WorkItem @title='x' @progressValue={{40}} @progressMax={{100}} @count='40 files' /></template>);
    assert.strictEqual(item().querySelector('.pretui-progress-count')?.textContent?.trim(), '40 files');
  });

  test('yields its default block into the body and the footer block after it', async function (assert) {
    await render(
      <template>
        <WorkItem @title='x' @activity='a'>
          <:default><span data-test-inner>inner</span></:default>
          <:footer><span data-test-foot>foot</span></:footer>
        </WorkItem>
      </template>,
    );
    assert.ok(item().querySelector('.pretui-workitem-body [data-test-inner]'));
    assert.ok(item().querySelector('[data-test-foot]'));
    assert.strictEqual(item().querySelector('.pretui-workitem-body [data-test-foot]'), null, 'the footer sits outside the body');
  });
});
