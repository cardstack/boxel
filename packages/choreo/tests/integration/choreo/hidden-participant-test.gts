/**
 * A participant under `display: none` (the `hidden` attribute, a folded
 * section) has no layout box: it measures as an empty rect at the page
 * origin. Shown again, it arrives where it lives, and is not moved there
 * from that corner. Hidden, it is not moved to that corner either.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion, Presence } from 'glimmer-motion';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame, sleep } from '../../helpers/motion';

let stage: Stage | undefined;

class Stage extends Component {
  @tracked hidden = true;
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    stage = this;
  }
  <template>
    <Choreo class='stage' style='position:relative;padding:80px' as |c|>
      <div
        data-row
        hidden={{this.hidden}}
        style='height:40px;background:#0af'
        {{motion id='row' role='row'}}
      ></div>
      <c.Move @of={{c.moved 'row'}} @duration={{1}} @ease='linear' />
      <c.Tween
        @of={{c.inserted 'row'}}
        @opacity={{array 0 1}}
        @duration={{1}}
        @ease='linear'
      />
    </Choreo>
  </template>
}

const keyOf = (item: { key: string }) => item.key;

class Fold extends Component {
  @tracked folded = false;
  @tracked items = [{ key: 'a' }];
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    fold = this;
  }
  <template>
    <Choreo as |c|>
      <div hidden={{this.folded}}>
        <Presence @items={{this.items}} @key={{keyOf}} as |item h|>
          <div
            class='leaver'
            style='height:40px'
            {{motion presence=h id=item.key role='card'}}
          ></div>
        </Presence>
      </div>
      <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @duration={{0.12}} />
    </Choreo>
  </template>
}

let fold: Fold | undefined;

const row = () => document.querySelector('[data-row]') as HTMLElement;
const unmoved = (el: HTMLElement) => {
  const transform = getComputedStyle(el).transform;
  return transform === 'none' || transform === '';
};

module('Integration | choreo | hidden participant', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  hooks.afterEach(() => {
    stage = undefined;
    fold = undefined;
  });

  test('a participant shown again arrives in place instead of moving from the origin', async function (assert) {
    await render(<template><Stage /></template>);
    stage!.hidden = false;
    await nextFrame();
    await nextFrame();
    assert.true(unmoved(row()), 'the row carries no move transform');
    assert.true(
      Number(getComputedStyle(row()).opacity) < 1,
      'the row fades in as an arrival',
    );
    await settled();
  });

  test('a participant hidden mid-region is not moved to the origin', async function (assert) {
    await render(<template><Stage /></template>);
    stage!.hidden = false;
    await settled();
    await sleep(1100);
    stage!.hidden = true;
    await nextFrame();
    await nextFrame();
    assert.strictEqual(
      row().style.transform,
      '',
      'no move is written to the hidden row',
    );
    await settled();
  });

  test('a <Presence> child that leaves while hidden still leaves', async function (assert) {
    await render(<template><Fold /></template>);
    await nextFrame();
    fold!.folded = true;
    await settled();
    fold!.items = [];
    await settled();
    await sleep(200);
    await settled();
    fold!.folded = false;
    await settled();
    assert.notOk(find('.leaver'), 'no ghost row when the fold opens');
  });
});
