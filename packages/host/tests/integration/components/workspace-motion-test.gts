import { on } from '@ember/modifier';
import { click, find } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { motion, type PerformCommand } from 'glimmer-motion';
import {
  animationsSettled,
  isMotionIdle,
  orphanCount,
  setupMotion,
  strandedTransforms,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import StackMotion from '@cardstack/host/components/operator-mode/stack-motion';
import WorkspaceScene from '@cardstack/host/components/operator-mode/workspace-scene';
import WorkspaceWallpaper from '@cardstack/host/components/operator-mode/workspace-wallpaper';
import {
  workspaceOpenOrigin,
  type WorkspaceOpenOrigin,
  type WorkspacePortal,
} from '@cardstack/host/lib/workspace-open-origin';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const imageA =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="16" height="9"%3E%3Cpath fill="blue" d="M0 0h16v9H0z"/%3E%3C/svg%3E';
const imageB = imageA.replace('blue', 'red');
class PortalFixture extends Component {
  @tracked chooser = true;
  @tracked wide = false;
  @tracked duration = 0.6;
  @tracked loaded = false;
  @tracked backgroundURL = imageA;
  @tracked portal?: WorkspacePortal;
  @tracked cardIds = ['previous-workspace'];
  private origin?: WorkspaceOpenOrigin;
  private sequence = 0;
  private start(direction: WorkspacePortal['direction']) {
    if (!this.origin) return;
    this.portal = {
      token: ++this.sequence,
      origin: this.origin,
      direction,
    };
  }
  open = (event: Event) => {
    let button = event.currentTarget as HTMLElement;
    this.backgroundURL = button.dataset.testTile === 'b' ? imageB : imageA;
    this.origin = workspaceOpenOrigin(
      event,
      'https://example.test/realm/',
      this.backgroundURL,
    );
    this.start('opening');
    this.cardIds = [`workspace-${this.sequence}`];
    this.chooser = false;
  };
  toggle = () => {
    this.chooser = !this.chooser;
    this.start(this.chooser ? 'closing' : 'opening');
  };
  resize = () => {
    this.wide = !this.wide;
    this.loaded = true;
  };
  instant = () => (this.duration = 0);
  complete = (command: PerformCommand) => {
    if (
      command.action === 'workspace-portal-complete' &&
      command.payload === this.portal?.token
    )
      this.portal = undefined;
  };
  get showChooser() {
    return this.chooser || !!this.portal;
  }
  get concealed() {
    return this.chooser && !this.portal;
  }
  <template>
    <button
      type='button'
      {{on 'click' this.toggle}}
      data-test-toggle
    >Dashboard</button>
    <button type='button' {{on 'click' this.resize}} data-test-resize>Content
      arrived / Resize</button>
    <button type='button' {{on 'click' this.instant}} data-test-instant>Skip
      motion</button>
    <StackMotion
      @duration={{this.duration}}
      @onPerform={{this.complete}}
      @portalActive={{if this.portal true false}}
    >
      <div class='frame {{if this.wide "wide"}}' data-test-frame>
        {{#if this.showChooser}}
          <div class='chooser' data-test-dashboard>
            <button
              class='tile'
              type='button'
              {{on 'click' this.open}}
              data-test-tile='a'
            ><span class='tile-icon'>Realm A</span></button>
            <button
              class='tile second'
              type='button'
              {{on 'click' this.open}}
              data-test-tile='b'
            ><span class='tile-icon'>Realm B</span></button>
          </div>
        {{/if}}
        <WorkspaceScene
          class='stage'
          @portal={{this.portal}}
          @concealed={{this.concealed}}
          @duration={{this.duration}}
        >
          <WorkspaceWallpaper @backgroundURL={{this.backgroundURL}} />
          <div class='stacks' {{motion role='workspace-cards'}}>
            {{#each this.cardIds as |id|}}
              <div
                class='card'
                {{motion
                  id=id
                  role=(if this.portal 'portal-card' 'stack-card')
                }}
                data-test-card
              >{{if
                  this.loaded
                  'Loaded realm index content'
                  'Index card'
                }}</div>
            {{/each}}
          </div>
        </WorkspaceScene>
      </div>
    </StackMotion>
    <style scoped>
      .frame {
        position: relative;
        width: 50rem;
        height: 30rem;
      }
      .frame.wide {
        width: 60rem;
        height: 36rem;
      }
      .stage {
        position: relative;
        width: 100%;
        height: 100%;
      }
      .stacks {
        position: relative;
        z-index: 1;
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
      }
      .card {
        width: 70%;
        height: 75%;
        background: white;
      }
      .chooser {
        position: absolute;
        inset: 0;
        z-index: 0;
        background: #222;
      }
      .tile {
        position: absolute;
        left: 3rem;
        top: 15rem;
        width: 12rem;
        height: 8rem;
        border-radius: 1rem;
        padding: 0;
        border: 0;
        overflow: hidden;
      }
      .second {
        left: 28rem;
        top: 7rem;
      }
      .tile-icon {
        display: block;
        width: 100%;
        height: 100%;
      }
      .tile-icon::before {
        content: '';
        position: absolute;
        inset: 0;
        background: blue;
        transform: scale(1.15);
      }
    </style>
  </template>
}
function frame() {
  return new Promise<void>((resolve) => {
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- Inspect painted motion, not application state.
    requestAnimationFrame(() => resolve());
  });
}
async function sample(assert: Assert) {
  let samples: {
    aperture: number;
    card: DOMRect;
    background: DOMRect;
    clip: string;
    opacity: number;
  }[] = [];
  let deadline = performance.now() + 3000;
  while (!isMotionIdle() && performance.now() < deadline) {
    let scene = find('.workspace-scene')!;
    if (scene.classList.contains('portal'))
      samples.push({
        aperture: (
          getComputedStyle(find('.workspace-wallpaper')!)
            .clipPath.split('round')[0]!
            .match(/[\d.]+/g) ?? []
        ).reduce((total, value) => total + Number(value), 0),
        card: find('[data-test-card]')!.getBoundingClientRect(),
        background: find('.workspace-wallpaper')!.getBoundingClientRect(),
        clip: getComputedStyle(find('.workspace-wallpaper')!).clipPath,
        opacity: Number(getComputedStyle(find('.stacks')!).opacity),
      });
    await frame();
  }
  assert.true(
    isMotionIdle(),
    'one action finishes without replaying its entrance',
  );
  await animationsSettled();
  return samples;
}
function cleanup(assert: Assert) {
  assert.dom('.portal').doesNotExist();
  assert.strictEqual(orphanCount(), 0);
  assert.deepEqual(strandedTransforms(), []);
}
module('Integration | workspace motion', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  test('the wallpaper opens first, then the card follows without stretching text', async function (assert) {
    await renderComponent(PortalFixture);
    await animationsSettled();
    let destination = find('[data-test-frame]')!.getBoundingClientRect();
    await click('[data-test-tile="a"]');
    assert.strictEqual(
      orphanCount(),
      0,
      'previous workspace has no competing exit',
    );
    let samples = await sample(assert);
    assert.true(samples.length > 2, 'sampled opening frames');
    let wallpaperOnly = samples.filter((s) => s.aperture > 0.1);
    assert.true(
      wallpaperOnly.length > 0,
      'wallpaper gets a visible head start',
    );
    assert.true(
      wallpaperOnly.every((s) => s.opacity === 0),
      'index card stays hidden while the wallpaper portal opens',
    );
    assert.true(
      wallpaperOnly.every(
        (s) => Math.abs(s.card.width - wallpaperOnly[0]!.card.width) < 1,
      ),
      'card holds its natural size before following',
    );
    assert.true(
      samples.some((s) => s.aperture < 0.1 && s.opacity > 0 && s.opacity < 1),
      'card fades after the wallpaper opens',
    );
    let finalCard = find('[data-test-card]')!.getBoundingClientRect();
    assert.true(
      samples.every(
        (s) =>
          Math.abs(s.card.width - finalCard.width) < 1 &&
          Math.abs(s.card.height - finalCard.height) < 1,
      ),
      'card content keeps its natural dimensions',
    );
    assert.true(
      samples.every((s) => Math.abs(s.card.y - finalCard.y) < 1),
      'the supporting card fade spends no geometry budget',
    );
    assert.true(
      samples.every((s) => s.clip.startsWith('inset(')),
      'portal is an aperture',
    );
    assert.true(
      samples.every(
        (s, i) => !i || s.aperture <= samples[i - 1]!.aperture + 0.1,
      ),
      'one forward tween, with no second zoom back',
    );
    for (let key of ['x', 'y', 'width', 'height'] as const)
      assert.true(
        samples.every(
          (s) => Math.abs(s.background[key] - destination[key]) < 1,
        ),
        `wallpaper ${key} is stationary`,
      );
    assert.true(
      samples.every((s) => Math.abs(s.card.x - finalCard.x) < 1),
      'card stays horizontally centered',
    );
    assert.dom('.stacks').hasStyle({ transform: 'none', opacity: '1' });
    assert.dom('[data-test-dashboard]').doesNotExist();
    cleanup(assert);
  });
  test('returning to the dashboard fades the card before reversing the wallpaper portal', async function (assert) {
    await renderComponent(PortalFixture);
    await animationsSettled();
    await click('[data-test-tile="a"]');
    await animationsSettled();
    await click('[data-test-toggle]');
    assert
      .dom('[data-test-dashboard]')
      .exists('dashboard is behind the shrinking portal');
    let samples = await sample(assert);
    assert.true(samples.length > 2);
    assert.true(
      samples.filter((s) => s.aperture > 0.1).every((s) => s.opacity === 0),
      'return retires the card before closing the wallpaper portal',
    );
    assert.true(
      samples.every(
        (s, i) => !i || s.aperture >= samples[i - 1]!.aperture - 0.1,
      ),
      'return is one continuous backward tween',
    );
    assert.true(
      samples.every((s) => Math.abs(s.card.y - samples[0]!.card.y) < 1),
      'the card fades in place while the wallpaper owns the geometry budget',
    );
    assert.dom('.workspace-scene').hasStyle({ visibility: 'hidden' });
    assert.dom('.workspace-scene').hasAttribute('inert');
    cleanup(assert);
  });
  test('reversal, replacement, late content, resize, and dropped frames reach the latest pose; reduced motion skips to it', async function (assert) {
    await renderComponent(PortalFixture);
    await animationsSettled();
    await click('[data-test-tile="a"]');
    await frame();
    await click('[data-test-toggle]');
    await frame();
    await click('[data-test-tile="b"]');
    await click('[data-test-resize]');
    let until = performance.now() + 700;
    while (performance.now() < until) {
      /* Stall beyond the full timeline. */
    }
    await animationsSettled();
    assert.dom('.stacks').hasStyle({ transform: 'none', opacity: '1' });
    assert.true(
      getComputedStyle(find('.workspace-wallpaper')!).backgroundImage.includes(
        'red',
      ),
      'only the latest realm survives',
    );
    cleanup(assert);
    await click('[data-test-instant]');
    await click('[data-test-toggle]');
    await animationsSettled();
    assert.dom('.workspace-scene').hasStyle({ visibility: 'hidden' });
    await click('[data-test-tile="a"]');
    await animationsSettled();
    assert.dom('.stacks').hasStyle({ transform: 'none', opacity: '1' });
    cleanup(assert);
  });
});
