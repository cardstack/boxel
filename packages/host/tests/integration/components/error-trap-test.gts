import { TemplateOnlyComponent } from '@ember/component/template-only';

import { settled } from '@ember/test-helpers';
import Component from '@glimmer/component';

import { module, test } from 'qunit';

import { TrackedObject } from 'tracked-built-ins';

import ErrorTrap from '@cardstack/host/components/error-trap';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | error-trap', function (hooks) {
  setupRenderingTest(hooks);

  test('passes through when there is no error', async function (assert) {
    const content = <template>
      <div data-test='message'>{{@params.message}}</div>
    </template> satisfies TemplateOnlyComponent<{
      Args: { params: { message: string } };
    }>;

    const params = new TrackedObject({
      message: 'hello',
    });

    await renderComponent(<template>
      <ErrorTrap @content={{content}} @params={{params}} />
    </template>);
    assert.dom('[data-test="message"]').containsText('hello');
  });

  test('re-renders normally', async function (assert) {
    const content = <template>
      <div data-test='message'>{{@params.message}}</div>
    </template> satisfies TemplateOnlyComponent<{
      Args: { params: { message: string } };
    }>;

    const params = new TrackedObject({
      message: 'hello',
    });

    await renderComponent(<template>
      <ErrorTrap @content={{content}} @params={{params}} />
    </template>);
    params.message = 'goodbye';
    await settled();
    assert.dom('[data-test="message"]').containsText('goodbye');
  });

  test('traps error on initial render', async function (assert) {
    class Content extends Component<{
      Args: { params: { mode: boolean } };
    }> {
      get message() {
        if (this.args.params.mode) {
          return 'Everything OK';
        } else {
          throw new Error('intentional exception');
        }
      }

      <template>
        <div data-test='message'>{{this.message}}</div>
      </template>
    }

    const params = new TrackedObject({
      mode: false,
    });

    await renderComponent(<template>
      <ErrorTrap @content={{Content}} @params={{params}} />
    </template>);
    assert.dom('[data-test-error-trap]').exists();
  });

  test('traps error on re-render', async function (assert) {
    class Content extends Component<{
      Args: { params: { mode: boolean } };
    }> {
      get message() {
        if (this.args.params.mode) {
          return 'Everything OK';
        } else {
          throw new Error('intentional exception');
        }
      }

      <template>
        <div data-test='message'>{{this.message}}</div>
      </template>
    }

    const params = new TrackedObject({
      mode: true,
    });

    await renderComponent(<template>
      <ErrorTrap @content={{Content}} @params={{params}} />
    </template>);
    assert.dom('[data-test="message"]').containsText('Everything OK');

    params.mode = false;
    await settled();
    assert.dom('[data-test-error-trap]').exists();
  });

  test('can recover', async function (assert) {
    class Content extends Component<{
      Args: { params: { mode: boolean } };
    }> {
      get message() {
        if (this.args.params.mode) {
          return 'Everything OK';
        } else {
          throw new Error('intentional exception');
        }
      }

      <template>
        <div data-test='message'>{{this.message}}</div>
      </template>
    }

    const params = new TrackedObject({
      mode: false,
    });

    await renderComponent(<template>
      <ErrorTrap @content={{Content}} @params={{params}} />
    </template>);

    assert.dom('[data-test-error-trap]').exists();

    params.mode = true;
    await settled();
    assert.dom('[data-test="message"]').containsText('Everything OK');
  });
});
