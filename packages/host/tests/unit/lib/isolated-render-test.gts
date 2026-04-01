import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';

import { settled } from '@ember/test-helpers';
import Component from '@glimmer/component';

import { module, test } from 'qunit';

import { render, teardown } from '@cardstack/host/lib/isolated-render';

import { setupRenderingTest } from '../../helpers/setup';

let destroyCount = 0;

class TeardownProbe extends Component {
  constructor(owner: Owner, args: object) {
    super(owner, args);
    registerDestructor(this, () => destroyCount++);
  }

  <template>
    <div data-render-probe>probe</div>
  </template>
}

module('Unit | isolated-render', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    destroyCount = 0;
  });

  test('render tears down the previous live tree before rerendering', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      render(TeardownProbe, element as any, this.owner);
      assert.strictEqual(
        destroyCount,
        0,
        'initial render keeps the component alive',
      );

      render(TeardownProbe, element as any, this.owner);
      await settled();
      assert.strictEqual(
        destroyCount,
        1,
        'rerender destroys the previous component tree before replacing it',
      );

      teardown(element as any);
      await settled();
      assert.strictEqual(
        destroyCount,
        2,
        'explicit teardown destroys the current component tree',
      );
    } finally {
      element.remove();
    }
  });
});
