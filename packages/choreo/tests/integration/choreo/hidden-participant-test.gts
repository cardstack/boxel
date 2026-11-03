/**
 * A participant under `display: none` (the `hidden` attribute, a folded
 * section) has no layout box: it measures as an empty rect at the page
 * origin. Shown again, it arrives where it lives, and is not moved there
 * from that corner. Hidden, it is not moved to that corner either.
 */
import { Choreo, type Rect } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { find, findAll, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion, Presence } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
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
            data-leaver
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

/** hoisted: the region fingerprints a timeline's functions by identity */
const line = (a: Rect, b: Rect) =>
  `M ${a.x + a.width} ${a.y + a.height / 2} L ${b.x} ${b.y + b.height / 2}`;

/** a region whose whole subtree an ancestor hides, as a buried stack card */
class Covered extends Component {
  @tracked covered = false;
  @tracked noise = 'x';
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    covered = this;
  }
  <template>
    <div hidden={{this.covered}}>
      <Choreo style='position:relative;width:300px;height:200px' as |c|>
        <div style='height:{{this.noise.length}}px'>{{this.noise}}</div>
        <div style='width:40px;height:20px' {{motion id='a'}}></div>
        <div
          style='margin-left:180px;width:40px;height:20px'
          {{motion id='b'}}
        ></div>
        <c.Tether
          @from={{c.id 'a'}}
          @to={{c.id 'b'}}
          @path={{line}}
          @name='w'
        />
      </Choreo>
    </div>
  </template>
}

let covered: Covered | undefined;

const wires = () => findAll('[data-choreo-tether]');

/** how many changes the page's DOM takes over a run of frames */
async function writesOver(frames: number) {
  let writes = 0;
  const observer = new MutationObserver((records) => {
    writes += records.length;
  });
  observer.observe(document.querySelector('#ember-testing')!, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  for (let i = 0; i < frames; i++) {
    await nextFrame();
  }
  observer.disconnect();
  return writes;
}

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
    covered = undefined;
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
    assert.notOk(find('[data-leaver]'), 'no ghost row when the fold opens');
  });

  test('a region hidden by an ancestor stops its run, and draws again when shown', async function (assert) {
    await render(<template><Covered /></template>);
    await animationsSettled();
    // a region compiles nothing on its first render: a pass is a change
    covered!.noise = 'xx';
    await settled();
    await nextFrame();
    await animationsSettled();
    assert.strictEqual(wires().length, 1, 'the standing wire is drawn');

    covered!.covered = true;
    await settled();
    await nextFrame();
    assert.strictEqual(
      await writesOver(10),
      0,
      'nothing under the cover is written to, frame after frame',
    );

    covered!.covered = false;
    await settled();
    await nextFrame();
    await animationsSettled();
    assert.strictEqual(wires().length, 1, 'the wire is drawn again');
    const d = wires()[0]!.getAttribute('d') ?? '';
    assert.false(d.startsWith('M 0 '), `drawn from its sprite: ${d}`);
  });
});
