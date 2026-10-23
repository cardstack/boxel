import { click } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { Button } from '@cardstack/pretui/components/button';
import { Field } from '@cardstack/pretui/components/field';
import { Input as PretuiInput } from '@cardstack/pretui/components/input';
import { Switch } from '@cardstack/pretui/components/switch';
import { Textarea as PretuiTextarea } from '@cardstack/pretui/components/textarea';
import { module, test } from 'qunit';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | pretui components', function (hooks) {
  setupRenderingTest(hooks);

  test('Button renders from the workspace package with its axes resolved', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Button
            @tone='danger'
            @appearance='outlined'
            @size='l'
          >Delete</Button>
        </template>
      },
    );

    assert.dom('[data-test-pretui-button]').hasTagName('button');
    assert.dom('[data-test-pretui-button]').hasText('Delete');
    assert.dom('[data-test-pretui-button]').hasClass('pretui-btn');
    assert
      .dom('[data-test-pretui-button]')
      .hasAttribute('data-tone', 'danger')
      .hasAttribute('data-appearance', 'outlined')
      .hasAttribute('data-size', 'l');
  });

  test('Switch toggles and notifies through the workspace package', async function (assert) {
    let seen: boolean[] = [];
    let onCheckedChange = (checked: boolean) => seen.push(checked);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><Switch @onCheckedChange={{onCheckedChange}} /></template>
      },
    );

    assert
      .dom('[data-test-pretui-switch]')
      .hasAttribute('aria-checked', 'false');
    await click('[data-test-pretui-switch]');
    assert
      .dom('[data-test-pretui-switch]')
      .hasAttribute('aria-checked', 'true');
    assert.deepEqual(seen, [true]);
  });

  test('an invalid Field dresses Input and Textarea through their wrappers', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Field @error='Required' as |controlId|>
            <PretuiInput @controlId={{controlId}} />
          </Field>
          <Field @error='Required' as |controlId|>
            <PretuiTextarea @controlId={{controlId}} />
          </Field>
        </template>
      },
    );

    let token = (selector: string, name: string) =>
      getComputedStyle(document.querySelector(selector)!)
        .getPropertyValue(name)
        .trim();

    let input = '[data-test-pretui-input]';
    assert.notStrictEqual(token(input, '--destructive-ink'), '');
    assert.strictEqual(
      token(input, '--border'),
      token(input, '--destructive-ink'),
      'Input takes the -ink edge',
    );
    assert.strictEqual(
      token(input, '--background'),
      token(input, '--field'),
      'Input is not tinted',
    );

    let textarea = '[data-test-pretui-textarea]';
    assert.strictEqual(
      token(textarea, '--border'),
      token(textarea, '--destructive'),
      'Textarea keeps the fill-hue edge',
    );
    assert.notStrictEqual(
      token(textarea, '--background'),
      token(textarea, '--field'),
      'Textarea is tinted',
    );
  });

  test('a disabled Input drops the error edge', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <PretuiInput @invalid={{true}} @disabled={{true}} />
          <Field @error='Required' as |controlId|>
            <PretuiInput @controlId={{controlId}} @disabled={{true}} />
          </Field>
        </template>
      },
    );

    let wrappers = [
      ...document.querySelectorAll('[data-test-pretui-input]'),
    ].map((el) => getComputedStyle(el));
    assert.strictEqual(wrappers.length, 2);
    for (let style of wrappers) {
      assert.strictEqual(
        style.getPropertyValue('--border').trim(),
        style.getPropertyValue('--input').trim(),
      );
    }
  });

  test('Input dims when disabled, not when read-only', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <PretuiInput @disabled={{true}} data-test-disabled />
          <PretuiInput @readonly={{true}} data-test-readonly />
          <PretuiInput @disabled={{true}} @readonly={{true}} data-test-both />
        </template>
      },
    );

    let opacity = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!).opacity;

    assert.strictEqual(opacity('[data-test-disabled]'), '0.45');
    assert.strictEqual(opacity('[data-test-readonly]'), '1');
    assert.strictEqual(
      opacity('[data-test-both]'),
      '0.45',
      'disabled wins over read-only',
    );
  });
});
