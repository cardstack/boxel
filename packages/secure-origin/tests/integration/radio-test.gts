import { array, fn } from '@ember/helper';
import { trackedObject } from '@ember/reactive/collections';
import { click, render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import Radio from '../../src/components/radio.gts';
import { eq } from '../../src/helpers/truth-helpers.ts';

// The component tests load no theme, so the panel's role tokens are set
// here, on a light surface under the dark color scheme the shell declares.
const PANEL = {
  'color-scheme': 'dark',
  '--background': 'rgb(255, 255, 255)',
  '--muted-foreground': 'rgb(95, 95, 107)',
  '--primary-ink': 'rgb(0, 112, 84)',
  '--boxel-radio-border-color': 'var(--muted-foreground)',
  '--boxel-radio-checked-color': 'var(--primary-ink)',
  '--boxel-body-font-size': '0.875rem',
};

function paintPanel() {
  let panel = document.querySelector<HTMLElement>('[data-test-panel]')!;
  for (let [name, value] of Object.entries(PANEL)) {
    panel.style.setProperty(name, value);
  }
}

function radio(value: string) {
  return document.querySelector<HTMLInputElement>(
    `[data-test-radio="${value}"]`,
  )!;
}

module('Integration | Radio', function (hooks) {
  setupRenderingTest(hooks);

  test('an unchosen button is an empty circle on the panel, and a chosen one a ring and dot in the primary ink', async function (assert) {
    const choice = trackedObject({ selected: 'schedule' });
    const select = (value: string) => (choice.selected = value);
    await render(
      <template>
        <div data-test-panel>
          {{#each (array 'schedule' 'opened') as |value|}}
            <Radio
              data-test-radio={{value}}
              @name='when'
              @value={{value}}
              @checked={{eq choice.selected value}}
              @onChange={{fn select value}}
            />
          {{/each}}
        </div>
      </template>,
    );
    paintPanel();

    let unchosen = getComputedStyle(radio('opened'));
    assert.strictEqual(
      unchosen.appearance,
      'none',
      'the browser draws none of it',
    );
    assert.strictEqual(
      unchosen.backgroundColor,
      PANEL['--background'],
      'an unchosen button is filled with the panel’s background, not the dark scheme’s',
    );
    assert.strictEqual(
      unchosen.borderTopColor,
      PANEL['--muted-foreground'],
      'and edged in the muted foreground',
    );
    assert.strictEqual(unchosen.boxShadow, 'none', 'with no dot');

    let chosen = getComputedStyle(radio('schedule'));
    assert.strictEqual(chosen.borderTopColor, PANEL['--primary-ink']);
    assert.strictEqual(
      chosen.backgroundColor,
      PANEL['--primary-ink'],
      'a chosen button’s dot is the primary ink',
    );
    assert.true(
      chosen.boxShadow.startsWith(PANEL['--background']),
      `inside a ring of the panel’s background (${chosen.boxShadow})`,
    );
    assert.true(chosen.boxShadow.includes('inset'), 'drawn inside its edge');
  });

  test('the buttons of one name are one native radio group', async function (assert) {
    const choice = trackedObject({ selected: 'schedule' });
    const select = (value: string) => (choice.selected = value);
    await render(
      <template>
        <div data-test-panel>
          {{#each (array 'schedule' 'opened') as |value|}}
            <Radio
              data-test-radio={{value}}
              @name='when'
              @value={{value}}
              @checked={{eq choice.selected value}}
              @onChange={{fn select value}}
            />
          {{/each}}
        </div>
      </template>,
    );

    for (let value of ['schedule', 'opened']) {
      assert.strictEqual(radio(value).type, 'radio');
      assert.strictEqual(radio(value).name, 'when');
    }
    assert.dom(radio('schedule')).isChecked();
    assert.dom(radio('opened')).isNotChecked();

    await click(radio('opened'));
    assert.strictEqual(choice.selected, 'opened', 'choosing one reports it');
    assert.dom(radio('opened')).isChecked();
    assert
      .dom(radio('schedule'))
      .isNotChecked('and the browser unchooses the other in its group');
  });
});
