/**
 * A card that opens another card over itself in the stack is buried until the
 * card above closes; it comes back scrolled to where it was left.
 */
import { click, triggerEvent, waitFor, waitUntil } from '@ember/test-helpers';

import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

import { modifier } from 'ember-modifier';
import { module, test } from 'qunit';
import { TrackedObject } from 'tracked-built-ins';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testRealmURL,
  visitOperatorMode,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

const ARTICLE = `${testRealmURL}Article/long`;
const NOTE = `${testRealmURL}Note/aside`;

const stackCard = (stack: number, index: number) =>
  `[data-test-operator-mode-stack="${stack}"] [data-test-stack-card-index="${index}"]`;

/** the element a stack item's card scrolls in */
function scrollerIn(stackItem: string): HTMLElement {
  let node = document.querySelector(
    `${stackItem} [data-test-article-end]`,
  )?.parentElement;
  while (node) {
    let { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  throw new Error(`no scroller in ${stackItem}`);
}

/** scrolls the card to `offset` as a user's wheel would, and waits for the scroll to be dispatched */
async function scrollCard(stackItem: string, offset: number) {
  let scroller = scrollerIn(stackItem);
  await triggerEvent(scroller, 'wheel', {
    deltaY: offset - scroller.scrollTop,
  });
  let scrolled = new Promise((resolve) =>
    scroller.addEventListener('scroll', resolve, { once: true }),
  );
  scroller.scrollTop = offset;
  await scrolled;
  return scroller.scrollTop;
}

/** the card's scroll offset once it has stopped moving */
async function restingOffset(stackItem: string) {
  let last = -1;
  let stableSince = performance.now();
  await waitUntil(
    () => {
      let current = scrollerIn(stackItem).scrollTop;
      if (current !== last) {
        last = current;
        stableSince = performance.now();
      }
      return performance.now() - stableSince >= 250;
    },
    { timeout: 3000, timeoutMessage: 'the scroll offset never settled' },
  );
  return last;
}

module(
  'Acceptance | interact submode | buried stack item scroll',
  function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    hooks.beforeEach(async function () {
      mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      class Note extends CardDef {
        static displayName = 'Note';
        @field body = contains(StringField);
      }
      // Much taller than the stack, with the linked note at its end. The long
      // read lays itself out from its own measurements, the way fitted tiles
      // and virtualized lists do: with no box (while a card covers it) it
      // collapses, and once it has a box again it takes a frame to grow back.
      // So as the article is uncovered its content is briefly short, which
      // clamps whatever offset the browser kept for it.
      class Article extends CardDef {
        static displayName = 'Article';
        @field note = linksTo(Note);
        static isolated = class Isolated extends Component<typeof Article> {
          layout = new TrackedObject({ laidOut: true });

          measure = modifier((element: HTMLElement) => {
            let observer = new ResizeObserver(([entry]) => {
              if (entry.contentRect.width === 0) {
                this.layout.laidOut = false;
              } else if (!this.layout.laidOut) {
                // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- models content that lays out a frame after it gets a box
                requestAnimationFrame(() => (this.layout.laidOut = true));
              }
            });
            observer.observe(element);
            return () => observer.disconnect();
          });

          <template>
            <div {{this.measure}}>
              <div class={{if this.layout.laidOut 'long-read' 'short-read'}}>
                A long read
              </div>
              <div data-test-article-end>
                <@fields.note />
              </div>
            </div>
            <style scoped>
              .long-read {
                height: 200rem;
              }
              .short-read {
                height: 10rem;
              }
            </style>
          </template>
        };
      }

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          'article.gts': { Article, Note },
          'Note/aside.json': new Note({ body: 'An aside' }),
          'Article/long.json': new Article({ note: new Note({ id: NOTE }) }),
        },
      });
    });

    test('closing the card above returns the card below to where it was scrolled', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: ARTICLE, format: 'isolated' }]],
      });
      await waitFor(`${stackCard(0, 0)} [data-test-article-end]`);
      let left = await scrollCard(stackCard(0, 0), 1200);
      assert.true(left > 0, `the article is scrolled (${left}px)`);

      await click(`${stackCard(0, 0)} [data-test-card="${NOTE}"]`);
      await waitFor(`${stackCard(0, 1)}[data-test-stack-card="${NOTE}"]`);
      await click(`${stackCard(0, 1)} [data-test-close-button]`);
      await waitFor(stackCard(0, 1), { count: 0 });

      assert.strictEqual(
        await restingOffset(stackCard(0, 0)),
        left,
        'the article is where it was left',
      );
    });

    test('a card buried in one of several stacks returns to where it was scrolled', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [{ id: ARTICLE, format: 'isolated' }],
          [{ id: ARTICLE, format: 'isolated' }],
        ],
      });
      await waitFor(`${stackCard(1, 0)} [data-test-article-end]`);
      let leftInFirst = await scrollCard(stackCard(0, 0), 600);
      let leftInSecond = await scrollCard(stackCard(1, 0), 1200);

      await click(`${stackCard(1, 0)} [data-test-card="${NOTE}"]`);
      await waitFor(`${stackCard(1, 1)}[data-test-stack-card="${NOTE}"]`);
      await click(`${stackCard(1, 1)} [data-test-close-button]`);
      await waitFor(stackCard(1, 1), { count: 0 });

      assert.strictEqual(
        await restingOffset(stackCard(1, 0)),
        leftInSecond,
        'the card that was buried is where it was left',
      );
      assert.strictEqual(
        await restingOffset(stackCard(0, 0)),
        leftInFirst,
        'the other stack kept its own place',
      );
    });

    test('each time the card is uncovered it returns to where it was last left, also through its buried header', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: ARTICLE, format: 'isolated' }]],
      });
      await waitFor(`${stackCard(0, 0)} [data-test-article-end]`);
      let left = await scrollCard(stackCard(0, 0), 1200);

      await click(`${stackCard(0, 0)} [data-test-card="${NOTE}"]`);
      await waitFor(`${stackCard(0, 1)}[data-test-stack-card="${NOTE}"]`);
      await click(`${stackCard(0, 1)} [data-test-close-button]`);
      await waitFor(stackCard(0, 1), { count: 0 });
      assert.strictEqual(await restingOffset(stackCard(0, 0)), left);

      let leftAgain = await scrollCard(stackCard(0, 0), 900);
      await click(`${stackCard(0, 0)} [data-test-card="${NOTE}"]`);
      await waitFor(`${stackCard(0, 1)}[data-test-stack-card="${NOTE}"]`);
      // clicking a buried card's header closes the cards above it
      await click(`${stackCard(0, 0)} [data-test-stack-card-header]`);
      await waitFor(stackCard(0, 1), { count: 0 });

      assert.strictEqual(
        await restingOffset(stackCard(0, 0)),
        leftAgain,
        'the article is where it was left the second time',
      );
    });
  },
);
