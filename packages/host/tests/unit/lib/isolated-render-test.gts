import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';

import { click, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';

import { module, test } from 'qunit';

import RealmSandboxTemplateIsland from '@cardstack/host/components/realm-sandbox-template-island';
import {
  rehydrateWithArgs,
  rehydrateReplacingActiveWithArgs,
  render,
  serializeWithArgs,
  suspendSerializedComponent,
  teardown,
} from '@cardstack/host/lib/isolated-render';

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

let interactions: string[] = [];

class FirstHotTemplate extends Component {
  record = () => interactions.push('first');

  <template>
    <button type='button' data-hot-template {{on 'click' this.record}}>
      VERSION ONE
    </button>
  </template>
}

class SecondHotTemplate extends Component {
  record = () => interactions.push('second');

  <template>
    <button type='button' data-hot-template {{on 'click' this.record}}>
      VERSION TWO
    </button>
  </template>
}

class NestedSandboxIsland extends Component<{
  Args: { component: typeof FirstHotTemplate };
}> {
  set = () => undefined;
  viewCard = () => undefined;
  context = undefined;

  <template>
    <div
      data-nested-sandbox-island
      {{RealmSandboxTemplateIsland
        @component
        cardOrField=@component
        model=this
        fields=this
        context=this.context
        format='isolated'
        set=this.set
        viewCard=this.viewCard
      }}
    ></div>
  </template>
}

module('Unit | isolated-render', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    destroyCount = 0;
    interactions = [];
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

  test('a compatible replacement program adopts the serialized DOM identity', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      serializeWithArgs(FirstHotTemplate, element as any, this.owner, {});
      let originalButton = element.querySelector('[data-hot-template]');
      assert.ok(originalButton, 'the first program rendered');

      rehydrateReplacingActiveWithArgs(
        SecondHotTemplate,
        element as any,
        this.owner,
        {},
      );

      assert.strictEqual(
        element.querySelector('[data-hot-template]'),
        originalButton,
        'the replacement program adopted the authored element',
      );
      assert.strictEqual(
        originalButton?.textContent?.trim(),
        'VERSION TWO',
        'the adopted element reflects the replacement template',
      );

      await click(originalButton as HTMLElement);
      assert.deepEqual(
        interactions,
        ['second'],
        'the adopted element uses only the replacement behavior',
      );
    } finally {
      teardown(element as any);
      element.remove();
    }
  });

  test('a nested SES island rehydrates its server DOM on first client attachment', function (assert) {
    let serverElement = document.createElement('div');
    let clientElement = document.createElement('div');
    document.body.appendChild(serverElement);
    document.body.appendChild(clientElement);

    try {
      serializeWithArgs(
        NestedSandboxIsland as any,
        serverElement as any,
        this.owner,
        {
          component: FirstHotTemplate,
        },
      );
      clientElement.innerHTML = serverElement.innerHTML;
      teardown(serverElement as any);

      let nestedIsland = clientElement.querySelector<HTMLElement>(
        '[data-nested-sandbox-island]',
      );
      let originalButton = nestedIsland?.querySelector('[data-hot-template]');
      assert.ok(originalButton, 'the server rendered the nested SES template');
      assert.true(
        suspendSerializedComponent(nestedIsland as any),
        'the outer owner parks the nested marker program before hydration',
      );

      rehydrateWithArgs(
        NestedSandboxIsland as any,
        clientElement as any,
        this.owner,
        { component: FirstHotTemplate },
      );

      assert.strictEqual(
        clientElement.querySelector('[data-hot-template]'),
        originalButton,
        'the first client modifier attachment preserves authored DOM identity',
      );
      assert.strictEqual(
        clientElement.querySelector<HTMLElement>('[data-nested-sandbox-island]')
          ?.dataset.realmSandboxIslandUpdate,
        'rehydrated',
        'the nested marker boundary takes the first-attachment hydration path',
      );
    } finally {
      teardown(serverElement as any);
      teardown(clientElement as any);
      serverElement.remove();
      clientElement.remove();
    }
  });
});
