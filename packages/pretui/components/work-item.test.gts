// Pretui — WorkItem unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
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
function part(el: HTMLElement, name: string): HTMLElement | null {
  return el.querySelector(`[data-test-pretui-work-item-${name}]`);
}
function text(el: HTMLElement | null): string | undefined {
  return el?.textContent?.trim();
}

module('Pretui | components/work-item', function (hooks) {
  setupCardTest(hooks);

  test('defaults to a pending step with the queued status word', async function (assert) {
    await render(<template><WorkItem @title='Index the realm' /></template>);
    assert.strictEqual(item().dataset['tier'], 'step');
    assert.strictEqual(item().dataset['state'], 'pending');
    assert.strictEqual(item().dataset['attention'], undefined);
    assert.strictEqual(text(part(item(), 'title')), 'Index the realm');
    assert.strictEqual(text(part(item(), 'status')), 'queued', 'a state always has a word, not only a hue');
    assert.strictEqual(part(item(), 'body'), null, 'no body without progress or activity');
  });

  test('each settled state draws its mark as an icon, never as a bare character', async function (assert) {
    await render(
      <template>
        <WorkItem @title='a' @state='running' />
        <WorkItem @title='b' @state='awaiting-approval' />
        <WorkItem @title='c' @state='completed' />
        <WorkItem @title='d' @state='failed' />
        <WorkItem @title='e' @state='canceled' />
      </template>,
    );
    let discs = items().map((i) => part(i, 'disc'));
    assert.ok(discs[0]?.querySelector('[data-test-pretui-spinner]'), 'running spins instead of drawing a mark');
    assert.strictEqual(discs[0]?.querySelector('svg'), null, 'and draws no mark beside the spinner');
    assert.deepEqual(
      discs.slice(1).map((d) => Boolean(d?.querySelector('svg'))),
      [true, true, true, true],
      'needs-you, done, failed and idle each draw an icon',
    );
    assert.deepEqual(
      discs.slice(1).map(text),
      ['', '', '', ''],
      'and no glyph character is printed as text beside it',
    );
    assert.deepEqual(
      discs.map((d) => d?.getAttribute('aria-hidden') ?? d?.firstElementChild?.getAttribute('aria-hidden')),
      [null, 'true', 'true', 'true', 'true'],
      'a mark is decoration: the status word says the state',
    );
  });

  test('each state family has a status word, and only needs-you lights the card', async function (assert) {
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
      items().map((i) => text(part(i, 'status'))),
      ['running…', 'needs you', 'done', 'failed', 'canceled'],
    );
    assert.deepEqual(
      items().map((i) => i.dataset['attention']),
      [undefined, 'true', undefined, undefined, undefined],
    );
  });

  test('an unknown state degrades to the idle tone and prints itself as the status', async function (assert) {
    await render(<template><WorkItem @title='x' @state='daydreaming' /></template>);
    assert.strictEqual(item().dataset['attention'], undefined);
    assert.strictEqual(item().dataset['recede'], 'true', 'idle work recedes like settled work');
    assert.ok(part(item(), 'disc')?.querySelector('svg'), 'it still draws a mark');
    assert.strictEqual(text(part(item(), 'status')), 'daydreaming', 'never a blank status');
  });

  test('a caller status, verb and tier override the derivations', async function (assert) {
    await render(<template><WorkItem @title='x' @tier='run' @verb='INDEX' @state='running' @status='3 of 9 realms' /></template>);
    assert.strictEqual(item().dataset['tier'], 'run');
    assert.strictEqual(text(part(item(), 'verb')), 'INDEX');
    assert.strictEqual(text(part(item(), 'status')), '3 of 9 realms');
  });

  test('progress grows a body with a progress bar, its count and the activity line', async function (assert) {
    await render(<template><WorkItem @title='x' @state='running' @progressValue={{3}} @progressMax={{9}} @activity='Reindexing lots…' /></template>);
    let body = part(item(), 'body') as HTMLElement;
    assert.ok(body);
    let bar = body.querySelector('[role="progressbar"]') as HTMLElement;
    assert.strictEqual(bar.getAttribute('aria-valuenow'), '3');
    assert.strictEqual(bar.getAttribute('aria-valuemax'), '9');
    assert.true(bar.textContent?.includes('3 / 9'), 'the count is derived when none is given');
    assert.strictEqual(text(part(body, 'activity')), 'Reindexing lots…');

    await render(<template><WorkItem @title='x' @progressValue={{40}} @progressMax={{100}} @count='40 files' /></template>);
    assert.true(part(item(), 'body')?.textContent?.includes('40 files'), 'a caller count replaces the derived one');
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
    let body = part(item(), 'body') as HTMLElement;
    assert.ok(body.querySelector('[data-test-inner]'));
    assert.ok(item().querySelector('[data-test-foot]'));
    assert.strictEqual(body.querySelector('[data-test-foot]'), null, 'the footer sits outside the body');
  });
});
