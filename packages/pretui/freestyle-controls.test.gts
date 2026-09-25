// Focused contract tests for the freestyle property lens. A handlerless
// argument is documentation, not an editable knob; handler-backed arguments
// stay interactive and report their parsed values.
import { module, test } from 'qunit';
import { click, fillIn, render } from '@ember/test-helpers';
import { array } from '@ember/helper';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import {
  UsageArray,
  UsageBool,
  UsageNumber,
  UsageString,
} from './freestyle';

class Sink {
  stringValue: string | undefined = undefined;
  boolValue: boolean | undefined = undefined;
  numberValue: number | null | undefined = undefined;
  arrayValue: string[] | undefined = undefined;

  takeString = (value: string) => (this.stringValue = value);
  takeBool = (value: boolean) => (this.boolValue = value);
  takeNumber = (value: number | null) => (this.numberValue = value);
  takeArray = (value: string[]) => (this.arrayValue = value);
}

module('Pretui | freestyle property controls', function (hooks) {
  setupCardTest(hooks);

  test(
    'handlerless values render honestly without interactive controls',
    async function (assert) {
      await render(<template>
        <UsageString @mode='prop' @name='label' @value='Tea lot' />
        <UsageBool @mode='prop' @name='enabled' @value={{false}} />
        <UsageNumber
          @mode='prop'
          @name='count'
          @value={{0}}
          @min={{0}}
          @max={{10}}
        />
      <UsageArray
        @mode='prop'
        @name='tags'
        @value={{array 'green' 'spring'}}
      />
      <UsageString
        @mode='prop'
        @name='default only'
        @defaultValue='documented default'
      />
      </template>);

      let values = Array.from(
        document.querySelectorAll('[data-test-pretui-prop-readonly]'),
      ).map((element) => element.textContent?.trim());
    assert.deepEqual(values, [
      'Tea lot',
      'false',
      '0',
      'green, spring',
      'documented default',
    ]);
      assert.strictEqual(
        document.querySelectorAll(
          '.proprow-control input, .proprow-control [role="switch"], .proprow-control [role="slider"]',
        ).length,
        0,
        'handlerless values expose no editable controls',
      );
    },
  );

  test(
    'handler-backed values remain interactive and report parsed values',
    async function (assert) {
      let sink = new Sink();
      await render(<template>
        <UsageString
          @mode='prop'
          @name='label'
          @value='Tea lot'
          @onInput={{sink.takeString}}
        />
        <UsageBool
          @mode='prop'
          @name='enabled'
          @value={{false}}
          @onInput={{sink.takeBool}}
        />
        <UsageNumber
          @mode='prop'
          @name='count'
          @value={{0}}
          @onInput={{sink.takeNumber}}
        />
        <UsageArray
          @mode='prop'
          @name='tags'
          @value={{array 'green'}}
          @onInput={{sink.takeArray}}
        />
      </template>);

      await fillIn('[aria-label="label"]', 'New lot');
      await click('[aria-label="enabled"]');
      await fillIn('[aria-label="count"]', '8');
      await fillIn('[aria-label="tags"]', 'green, spring');

      assert.strictEqual(sink.stringValue, 'New lot');
      assert.strictEqual(sink.boolValue, true);
      assert.strictEqual(sink.numberValue, 8);
      assert.deepEqual(sink.arrayValue, ['green', 'spring']);
      assert.strictEqual(
        document.querySelectorAll('[data-test-pretui-prop-readonly]').length,
        0,
        'editable values do not also render a read-only duplicate',
      );
    },
  );

  test(
    'hideControls suppresses both editable and read-only property rows',
    async function (assert) {
      let sink = new Sink();
      await render(<template>
        <UsageString
          @mode='prop'
          @name='hidden read-only'
          @value='x'
          @hideControls={{true}}
        />
        <UsageString
          @mode='prop'
          @name='hidden editable'
          @value='y'
          @onInput={{sink.takeString}}
          @hideControls={{true}}
        />
      </template>);

      assert.strictEqual(document.querySelectorAll('.proprow').length, 0);
    },
  );
});
