// Pretui — FreestyleUsage unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FreestyleUsage } from './freestyle-usage';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-usage]') as HTMLElement;
}
function titles(): string[] {
  return Array.from(root().querySelectorAll('[data-test-pretui-usage-section-title]')).map((h) => h.textContent?.trim() ?? '');
}

module('Pretui | components/freestyle-usage', function (hooks) {
  setupCardTest(hooks);

  test('the minimum page: a description line and the example inside a Viewport artboard', async function (assert) {
    await render(
      <template>
        <FreestyleUsage @name='Button' @description='Primary action.'>
          <:example><button type='button' data-test-demo>Go</button></:example>
        </FreestyleUsage>
      </template>,
    );
    assert.strictEqual(root().querySelector('[data-test-pretui-usage-description]')?.textContent, 'Primary action.');
    assert.ok(root().querySelector('[data-test-pretui-viewport] [data-test-pretui-artboard-body] [data-test-demo]'), 'the example is framed, so it can be resized');
    assert.strictEqual(root().querySelector('[data-test-pretui-usage-source]'), null, 'no source, no code strip');
    assert.deepEqual(titles(), [], 'no api block, no Properties aside and no API table');
  });

  test('the description block wins over the arg, and a source string gets a code strip with a copy button', async function (assert) {
    await render(
      <template>
        <FreestyleUsage @description='ignored' @source='<Button>Go</Button>'>
          <:description>From the <em>block</em></:description>
          <:example>x</:example>
        </FreestyleUsage>
      </template>,
    );
    assert.strictEqual(root().querySelector('[data-test-pretui-usage-description]')?.textContent, 'From the block');
    assert.strictEqual(root().querySelector('[data-test-pretui-usage-source-code]')?.textContent, '<Button>Go</Button>');
    assert.ok(root().querySelector('[data-test-pretui-usage-source] [data-test-pretui-copy-button]'), 'copy usage');
  });

  test('the api block is yielded twice — once as knobs in the Properties aside, once as rows in the API table', async function (assert) {
    let seen: string[] = [];
    let onInput = (v: string) => seen.push(v);
    await render(
      <template>
        <FreestyleUsage>
          <:example>x</:example>
          <:api as |Args|>
            <Args.String @name='label' @description='Text' @defaultValue='Go' @value='Go' @onInput={{onInput}} />
            <Args.Bool @name='disabled' @value={{false}} @onInput={{onInput}} />
            <Args.Action @name='onClick' @description='Fires on press' />
            <Args.Yield @name='default' />
          </:api>
          <:cssVars as |Css|>
            <Css.Basic @name='--pretui-btn-radius' @defaultValue='6px' @value='6px' @onInput={{onInput}} />
          </:cssVars>
        </FreestyleUsage>
      </template>,
    );
    assert.deepEqual(titles(), ['Properties', 'API', 'CSS Variables']);
    let aside = root().querySelector('[data-test-pretui-usage-props]') as HTMLElement;
    assert.deepEqual(Array.from(aside.querySelectorAll('[data-test-pretui-prop-row-label]')).map((l) => l.textContent?.trim()), ['label', 'disabled', '--pretui-btn-radius'], 'actions and yields have no knob');
    let apiRows = Array.from(root().querySelector('[data-test-pretui-usage-api]')?.querySelectorAll('[data-test-pretui-usage-arg]') ?? []);
    assert.deepEqual(apiRows.map((r) => r.querySelector('th')?.textContent?.replace(/\s+/g, ' ').trim()), ['@label', '@disabled', '@onClick', '{{default}}']);
    assert.deepEqual(apiRows.map((r) => r.querySelector('td')?.textContent?.trim()), ['String', 'Bool', 'Action', 'Yield']);
    let cssRows = Array.from(root().querySelector('[data-test-pretui-usage-css-vars]')?.querySelectorAll('[data-test-pretui-usage-arg]') ?? []);
    assert.deepEqual(cssRows.map((r) => Array.from(r.querySelectorAll(':is(th, td)')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim())), [['--pretui-btn-radius', 'CSS', '', '6px']]);
  });
});
