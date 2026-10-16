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
const SETTLING_ARTICLE = `${testRealmURL}Article/settles`;
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

/** the card's scroll offset once its content has settled and it has stopped moving */
async function restingOffset(stackItem: string) {
  await waitUntil(
    () =>
      !document.querySelector(
        `${stackItem} .lead.tall, ${stackItem} .row.short`,
      ),
    { timeout: 5000, timeoutMessage: 'the article never settled' },
  );
  let last = -1;
  let stableSince = performance.now();
  await waitUntil(
    () => {
      let current = scrollerIn(stackItem).scrollTop;
      if (current !== last) {
        last = current;
        stableSince = performance.now();
      }
      return performance.now() - stableSince >= 300;
    },
    { timeout: 5000, timeoutMessage: 'the scroll offset never settled' },
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
      // read lays itself out from its own measurements, the way fitted tiles,
      // virtualized lists and live previews do: it reflows while it has no box
      // (while a card covers it), and only settles back to its laid-out height
      // some time after it has a box again. So as the article is uncovered its
      // content isn't at its settled size. Content that `grows` back is short
      // at that moment, which clamps the offset the browser kept for it.
      // Content that `shrinks` back keeps a tall lead above the rows for a
      // while, then drops it, and scroll anchoring moves the offset to keep the
      // rows in view where they were.
      class Article extends CardDef {
        static displayName = 'Article';
        @field note = linksTo(Note);
        @field reflow = contains(StringField);
        static isolated = class Isolated extends Component<typeof Article> {
          rows = Array.from({ length: 40 }, (_, index) => index);
          layout = new TrackedObject({ state: 'laid-out', settling: false });

          measure = modifier((element: HTMLElement) => {
            let observer = new ResizeObserver(([entry]) => {
              if (entry.contentRect.width === 0) {
                this.layout.state =
                  this.args.model.reflow === 'shrinks' ? 'tall' : 'short';
              } else if (
                this.layout.state !== 'laid-out' &&
                !this.layout.settling
              ) {
                this.layout.settling = true;
                let settle = () => {
                  this.layout.state = 'laid-out';
                  this.layout.settling = false;
                };
                if (this.layout.state === 'short') {
                  // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- models content that lays out a frame after it gets a box
                  requestAnimationFrame(settle);
                } else {
                  setTimeout(settle, 1000);
                }
              }
            });
            observer.observe(element);
            return () => observer.disconnect();
          });

          <template>
            <div {{this.measure}}>
              <div class='lead {{this.layout.state}}'></div>
              {{#each this.rows}}
                <div class='row {{this.layout.state}}'>A long read</div>
              {{/each}}
              <div data-test-article-end>
                <@fields.note />
              </div>
            </div>
            <style scoped>
              .lead.tall {
                height: 40rem;
              }
              .row {
                height: 5rem;
              }
              .row.short {
                height: 0.25rem;
                overflow: hidden;
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
          'Article/long.json': new Article({
            note: new Note({ id: NOTE }),
            reflow: 'grows',
          }),
          'Article/settles.json': new Article({
            note: new Note({ id: NOTE }),
            reflow: 'shrinks',
          }),
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

    test('a card whose content settles shorter after it is uncovered returns to where it was scrolled', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: SETTLING_ARTICLE, format: 'isolated' }]],
      });
      await waitFor(`${stackCard(0, 0)} [data-test-article-end]`);
      let left = await scrollCard(stackCard(0, 0), 1200);

      await click(`${stackCard(0, 0)} [data-test-card="${NOTE}"]`);
      await waitFor(`${stackCard(0, 1)}[data-test-stack-card="${NOTE}"]`);
      await click(`${stackCard(0, 1)} [data-test-close-button]`);
      await waitFor(stackCard(0, 1), { count: 0 });

      assert.strictEqual(
        await restingOffset(stackCard(0, 0)),
        left,
        'the article is where it was left once its content has settled',
      );
    });

    test("scrolling while the card is still being restored isn't undone", async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: SETTLING_ARTICLE, format: 'isolated' }]],
      });
      await waitFor(`${stackCard(0, 0)} [data-test-article-end]`);
      await scrollCard(stackCard(0, 0), 1200);

      await click(`${stackCard(0, 0)} [data-test-card="${NOTE}"]`);
      await waitFor(`${stackCard(0, 1)}[data-test-stack-card="${NOTE}"]`);
      await click(`${stackCard(0, 1)} [data-test-close-button]`);
      await waitFor(stackCard(0, 1), { count: 0 });
      let mine = await scrollCard(stackCard(0, 0), 900);
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert
        .dom(`${stackCard(0, 0)} .lead.tall`)
        .exists('the article is still settling, so a restore would still run');
      assert.strictEqual(
        scrollerIn(stackCard(0, 0)).scrollTop,
        mine,
        'the article stays where the user scrolled it',
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
