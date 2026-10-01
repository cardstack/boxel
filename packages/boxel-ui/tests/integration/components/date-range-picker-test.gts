import { DateRangePicker } from '@cardstack/boxel-ui/components';
import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';

function dataDate(date: Date) {
  let pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

module('Integration | Component | date-range-picker', function (hooks) {
  setupRenderingTest(hooks);

  test('with no range selected it opens on the default center it is given', async function (assert) {
    // A month no real clock running this suite will be in, so passing proves
    // the calendars followed the argument rather than today.
    let center = new Date(2024, 1, 15);
    let selected = { start: null, end: null };
    let onSelect = () => {};

    await render(
      <template>
        <DateRangePicker
          @defaultCenter={{center}}
          @selected={{selected}}
          @onSelect={{onSelect}}
        />
      </template>,
    );

    assert
      .dom('.ember-power-calendar-day[data-date="2024-02-15"]')
      .exists('the left calendar shows the default center’s month');
    assert
      .dom('.ember-power-calendar-day[data-date="2024-03-15"]')
      .exists('and the right calendar the month after it');
  });

  test('with no range and no default center it opens on today', async function (assert) {
    let selected = { start: null, end: null };
    let onSelect = () => {};

    await render(
      <template>
        <DateRangePicker @selected={{selected}} @onSelect={{onSelect}} />
      </template>,
    );

    assert
      .dom(`.ember-power-calendar-day[data-date="${dataDate(new Date())}"]`)
      .exists('today’s month is shown');
  });
});
