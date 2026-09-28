// Pretui — RelativeTime unit tests. Imports from ../reading-extras; when
// RelativeTime moves to its own file only the import path changes. Every
// assertion passes @now: without it the component falls back to the clock it
// read at construction, and the assertion would depend on wall time.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { RelativeTime } from './relative-time';

const NOW = '2026-09-04T12:00:00Z';

function el(): HTMLElement {
  return document.querySelector('[data-test-pretui-relative-time]') as HTMLElement;
}

module('Pretui | components/relative-time', function (hooks) {
  setupCardTest(hooks);

  test('is a <time> with a machine datetime, an absolute title, and a relative phrase', async function (assert) {
    await render(<template><RelativeTime @date='2026-09-04T09:00:00Z' @now={{NOW}} /></template>);
    assert.strictEqual(el().tagName, 'TIME');
    assert.strictEqual(el().getAttribute('datetime'), '2026-09-04T09:00:00.000Z');
    assert.strictEqual(el().textContent?.trim(), '3 hours ago');
    assert.true((el().getAttribute('title') ?? '').length > 0, 'the exact moment is a hover away');
  });

  test('picks the largest unit that fits, in both directions', async function (assert) {
    await render(
      <template>
        <RelativeTime @date='2026-09-04T11:59:30Z' @now={{NOW}} />
        <RelativeTime @date='2026-09-04T11:15:00Z' @now={{NOW}} />
        <RelativeTime @date='2026-09-01T12:00:00Z' @now={{NOW}} />
        <RelativeTime @date='2026-09-11T12:00:00Z' @now={{NOW}} />
        <RelativeTime @date='2025-09-04T12:00:00Z' @now={{NOW}} />
      </template>,
    );
    assert.deepEqual(
      Array.from(document.querySelectorAll('[data-test-pretui-relative-time]')).map((e) => e.textContent?.trim()),
      ['30 seconds ago', '45 minutes ago', '3 days ago', 'next week', '12 months ago'],
      // 365 days is just short of the 365.25-day year rung, so it reads as months
    );
  });

  test('numeric=auto says "yesterday"; numeric=always says "1 day ago"; format changes the wording', async function (assert) {
    await render(
      <template>
        <RelativeTime @date='2026-09-03T12:00:00Z' @now={{NOW}} />
        <RelativeTime @date='2026-09-03T12:00:00Z' @now={{NOW}} @numeric='always' />
        <RelativeTime @date='2026-09-03T12:00:00Z' @now={{NOW}} @numeric='always' @format='narrow' />
      </template>,
    );
    assert.deepEqual(
      Array.from(document.querySelectorAll('[data-test-pretui-relative-time]')).map((e) => e.textContent?.trim()),
      ['yesterday', '1 day ago', '1d ago'],
    );
  });

  test('renders an empty <time> with no datetime for an unparseable date', async function (assert) {
    await render(<template><RelativeTime @date='not a date' @now={{NOW}} /></template>);
    assert.strictEqual(el().textContent?.trim(), '');
    assert.strictEqual(el().getAttribute('datetime'), null);
  });
});
