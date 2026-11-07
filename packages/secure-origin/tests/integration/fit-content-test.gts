import { trackedObject } from '@ember/reactive/collections';
import { render, settled, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { Textarea } from '@cardstack/pretui/components/textarea';

import { fitContent } from '../../src/modifiers/fit-content.ts';

const noop = () => {};

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

// fitContent on Pret UI's Textarea, as the service account's scopes field
// uses it, where the browser doesn't size a field by its content.
module('Integration | fitContent', function (hooks) {
  setupRenderingTest(hooks);

  test('a textarea the browser doesn’t size by its content is as tall as its wrapped lines', async function (assert) {
    const field = trackedObject({ value: SCOPES[0] });
    await render(
      <template>
        <div data-test-narrow>
          <Textarea
            @value={{field.value}}
            @onInput={{noop}}
            {{fitContent field.value}}
          />
        </div>
      </template>,
    );
    let textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    // Narrow enough that each scope wraps, and sized as a browser without
    // `field-sizing: content` sizes it.
    document
      .querySelector<HTMLElement>('[data-test-narrow]')!
      .style.setProperty('width', '12rem');
    textarea.style.setProperty('field-sizing', 'fixed');

    field.value = SCOPES.join('\n');
    await settled();

    assert.ok(
      textarea.scrollHeight <= textarea.clientHeight + 1,
      `the textarea shows every wrapped line without scrolling (${textarea.scrollHeight}px of content in ${textarea.clientHeight}px)`,
    );
    let fitted = textarea.clientHeight;

    field.value = SCOPES[0];
    await settled();
    assert.ok(
      textarea.clientHeight < fitted,
      'it fits again, shorter, when the value shrinks',
    );
  });

  test('a textarea the browser doesn’t size by its content fits again when its width changes', async function (assert) {
    const field = trackedObject({ value: SCOPES[0] });
    await render(
      <template>
        <div data-test-narrow>
          <Textarea
            @value={{field.value}}
            @onInput={{noop}}
            {{fitContent field.value}}
          />
        </div>
      </template>,
    );
    let container = document.querySelector<HTMLElement>('[data-test-narrow]')!;
    let textarea = document.querySelector<HTMLTextAreaElement>('textarea')!;
    container.style.setProperty('width', '40rem');
    textarea.style.setProperty('field-sizing', 'fixed');
    field.value = SCOPES.join('\n');
    await settled();
    let wide = textarea.clientHeight;

    container.style.setProperty('width', '12rem');
    await waitUntil(() => textarea.clientHeight > wide);
    assert.ok(
      textarea.scrollHeight <= textarea.clientHeight + 1,
      `narrower, it shows every wrapped line without scrolling (${textarea.scrollHeight}px of content in ${textarea.clientHeight}px)`,
    );

    container.style.setProperty('width', '40rem');
    await waitUntil(() => textarea.clientHeight === wide);
    assert.strictEqual(
      textarea.clientHeight,
      wide,
      'wider again, it drops the rows it no longer needs',
    );
  });
});
