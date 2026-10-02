/**
 * Port of Motion's packages/framer-motion/src/components/AnimatePresence/__tests__/reentry-during-exit.test.tsx (motion@v13.4.6).
 *   act(() => setState(…)) → act(() => …): run() flushes the re-render before it returns, so two
 *   flips in a row leave no gap for an exit to resolve in, as in React
 *   <PresenceContext.Provider value={…}> → a hand-built PresenceHandle passed as `presence=`
 * React mounts inside render's act; a motion element mounts in Ember's afterRender queue, which
 * `await render()` drains, so each case goes on straight after render as upstream's does.
 */
import { run } from '@ember/runloop';
import { find, render } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import type { PresenceHandle } from 'glimmer-motion/presence-types';
import { setupMotion } from 'glimmer-motion/test-support';
import type { PresenceContextProps } from 'motion-dom';
import { MotionGlobalConfig } from 'motion-utils';
import { module, test } from 'qunit';

import { nextFrame, sleep, spy } from '../../helpers/motion';

// eslint-disable-next-line ember/no-runloop -- React's act: the re-render has to land before the next statement runs
const act = (fn: () => void) => run(fn);
const keyOf = (it: { key: string }) => it.key;
const byTestId = (id: string) => find(`[data-testid="${id}"]`) as HTMLElement;

/** a PresenceContext.Provider whose value is rebuilt from `isPresent` on every render */
class PresenceProvider implements PresenceHandle {
  @tracked isPresent = true;
  readonly key = 'child';
  readonly mode = 'sync' as const;
  readonly anchorX = 'left' as const;
  readonly anchorY = 'top' as const;
  private onExitComplete: (id: string | number) => void;
  constructor(onExitComplete: (id: string | number) => void) {
    this.onExitComplete = onExitComplete;
  }
  get context(): PresenceContextProps {
    return {
      id: 'child',
      isPresent: this.isPresent,
      onExitComplete: this.onExitComplete,
      register: () => () => {},
    };
  }
  popCandidate() {
    return () => {};
  }
  subscribe() {
    return () => {};
  }
}

module(
  'Integration | motion | AnimatePresence re-entry during exit',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);

    hooks.beforeEach(function () {
      MotionGlobalConfig.instantAnimations = true;
    });
    hooks.afterEach(function () {
      MotionGlobalConfig.instantAnimations = false;
    });

    test("first child of initial={false} doesn't get stuck at initial when its previous exit resolved after re-entry", async function (assert) {
      class Island {
        @tracked mode: 'bar' | 'panel' = 'bar';
        get items() {
          return [{ key: this.mode }];
        }
      }
      const island = new Island();
      const initial = { opacity: 0, scale: 0 },
        animate = { opacity: 1, scale: 1 },
        exit = { opacity: 0, scale: 0 };
      await render(
        <template>
          <Presence
            @items={{island.items}}
            @key={{keyOf}}
            @mode="popLayout"
            @initial={{false}}
            as |it h|
          ><div
              data-testid={{it.key}}
              {{motion presence=h initial=initial animate=animate exit=exit}}
            ></div></Presence>
        </template>
      );
      const bar = () => byTestId('bar');

      // Exit resolves on the next frame, after the element has re-entered
      act(() => (island.mode = 'panel'));
      act(() => (island.mode = 'bar'));
      await nextFrame();
      assert.strictEqual(bar().style.opacity, '1');

      act(() => (island.mode = 'panel'));
      act(() => (island.mode = 'bar'));
      await nextFrame();
      await nextFrame();

      assert.strictEqual(bar().style.opacity, '1');
      assert.true(
        bar().style.transform === 'none' || bar().style.transform === '',
        `transform ${bar().style.transform}`
      );
    });

    test("an exit that resolves after re-entry doesn't report exit complete", async function (assert) {
      const onExitComplete = spy<[string | number]>();
      const provider = new PresenceProvider(onExitComplete);
      const initial = { opacity: 0, scale: 0 },
        animate = { opacity: 1, scale: 1 },
        exit = { opacity: 0, scale: 0 };
      await render(
        <template>
          <div
            {{motion
              presence=provider
              initial=initial
              animate=animate
              exit=exit
            }}
          ></div>
        </template>
      );
      onExitComplete.calls.length = 0;

      act(() => (provider.isPresent = false));
      act(() => (provider.isPresent = true));
      await nextFrame();
      await nextFrame();

      assert.strictEqual(onExitComplete.calls.length, 0);
    });

    test('first child of initial={false} replays its enter when re-entering after its exit completed', async function (assert) {
      MotionGlobalConfig.instantAnimations = false;

      class Visibility {
        @tracked isVisible = true;
        get items() {
          return this.isVisible ? [{ key: 'group' }] : [];
        }
      }
      const v = new Visibility();
      const fadeIn = { opacity: 1 },
        hidden = { opacity: 0 },
        fastExit = { opacity: 0, transition: { duration: 0.05 } },
        fast = { duration: 0.05 },
        slowExit = { opacity: 0, transition: { duration: 10 } };
      // <div key="group"> is a plain element, so each motion child is handed the presence directly
      await render(
        <template>
          <Presence
            @items={{v.items}}
            @key={{keyOf}}
            @initial={{false}}
            as |it h|
          ><div>
              <div
                data-testid="fast"
                {{motion
                  presence=h
                  initial=hidden
                  animate=fadeIn
                  exit=fastExit
                  transition=fast
                }}
              ></div>
              <div {{motion presence=h animate=fadeIn exit=slowExit}}></div>
            </div></Presence>
        </template>
      );
      const fastEl = () => byTestId('fast');
      assert.strictEqual(fastEl().style.opacity, '1');

      act(() => (v.isVisible = false));
      await sleep(200);
      assert.strictEqual(fastEl().style.opacity, '0');

      act(() => (v.isVisible = true));
      await sleep(200);
      assert.strictEqual(fastEl().style.opacity, '1');
    });
  }
);
