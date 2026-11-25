// Pretui — Timeline unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Timeline } from './timeline';
import type { TimelineEvent } from './timeline';

const EVENTS: TimelineEvent[] = [
  { id: 'e1', title: 'Lot received', at: '2026-09-01T09:00:00Z', token: 'LOT-0412', person: 'Mei Ling', body: 'Twelve crates, all sealed.' },
  { id: 'e2', title: 'Cupping panel', at: '2026-09-03T09:00:00Z', status: 'passed' },
  { id: 'e3', title: 'Published' },
];

function list(): HTMLElement {
  return document.querySelector('[data-test-pretui-timeline]') as HTMLElement;
}
function events(): HTMLElement[] {
  return Array.from(list().querySelectorAll('.pretui-timeline-event')) as HTMLElement[];
}

module('Pretui | components/timeline', function (hooks) {
  setupCardTest(hooks);

  test('is a named ordered list in the order given, expanded by default', async function (assert) {
    await render(<template><Timeline @events={{EVENTS}} @now='2026-09-04T12:00:00Z' /></template>);
    assert.strictEqual(list().tagName, 'OL');
    assert.strictEqual(list().getAttribute('role'), 'list', 'list-style:none strips list semantics in VoiceOver');
    assert.strictEqual(list().getAttribute('aria-label'), 'Timeline');
    assert.strictEqual(list().dataset['density'], 'expanded');
    assert.deepEqual(events().map((e) => e.querySelector('.pretui-timeline-title')?.textContent?.trim()), ['Lot received', 'Cupping panel', 'Published']);
    assert.deepEqual(events().map((e) => e.querySelector('.pretui-timeline-marker')?.getAttribute('aria-hidden')), ['true', 'true', 'true'], 'the rail markers are chrome');
  });

  test('dresses each event from its fields: Token, StatusChip, person Avatar, body', async function (assert) {
    await render(<template><Timeline @events={{EVENTS}} @now='2026-09-04T12:00:00Z' /></template>);
    let [first, second, third] = events();
    assert.strictEqual(first?.querySelector('[data-test-pretui-token]')?.textContent?.trim(), 'LOT-0412');
    assert.true(first?.querySelector('.pretui-timeline-person')?.textContent?.includes('Mei Ling'));
    assert.ok(first?.querySelector('[data-test-pretui-avatar]'));
    assert.strictEqual(first?.querySelector('.pretui-timeline-detail')?.textContent?.trim(), 'Twelve crates, all sealed.');
    assert.strictEqual(second?.querySelector('[data-test-pretui-status-chip]')?.textContent?.trim(), 'passed');
    assert.strictEqual(third?.querySelector('[data-test-pretui-token]'), null, 'no empty slots on a bare event');
    assert.strictEqual(third?.querySelector('.pretui-timeline-detail'), null);
  });

  test("a status sits on the title's line, toned by statusTone when the event gives one", async function (assert) {
    const toned: TimelineEvent[] = [
      { id: 't1', title: 'Fetch open issues', status: 'Running', statusTone: 'info' },
      { id: 't2', title: 'Write digest', status: 'Failed here', statusTone: 'danger' },
      { id: 't3', title: 'Commit', status: 'Not started', statusTone: 'neutral' },
    ];
    await render(<template><Timeline @events={{toned}} /></template>);
    let [first, second] = events();
    let chip = (event: HTMLElement | undefined) => event?.querySelector<HTMLElement>('[data-test-pretui-status-chip]');
    assert.strictEqual(chip(first)?.textContent?.trim(), 'Running');
    assert.strictEqual(chip(first)?.getAttribute('data-tone'), 'info');
    assert.strictEqual(chip(second)?.getAttribute('data-tone'), 'danger');
    let third = events()[2];
    assert.strictEqual(chip(third)?.getAttribute('data-tone'), 'neutral');
    assert.strictEqual(
      chip(third)?.style.getPropertyValue('--pretui-chip-hue').trim(),
      'var(--muted-foreground)',
      'a neutral status has a muted dot, not a hue derived from its value',
    );
  });

  test('a default block replaces the body per event, and a marker block the glyph', async function (assert) {
    await render(
      <template>
        <Timeline @events={{EVENTS}} @density='compact' @label='Lot history'>
          <:marker as |event|><b data-test-mark>{{event.id}}</b></:marker>
          <:default as |event|><i data-test-detail>{{event.title}}!</i></:default>
        </Timeline>
      </template>,
    );
    assert.strictEqual(list().dataset['density'], 'compact');
    assert.strictEqual(list().getAttribute('aria-label'), 'Lot history');
    assert.deepEqual(Array.from(list().querySelectorAll('[data-test-mark]')).map((m) => m.textContent), ['e1', 'e2', 'e3']);
    assert.strictEqual(list().querySelectorAll('[data-test-detail]').length, 3, 'even events with no body get the block');
  });
});
