import { click, fillIn, find, typeIn, settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  Deferred,
  type LooseSingleCardDocument,
  rri,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import { testRealmURL, visitOperatorMode } from '../../helpers';
import { setupInteractSubmodeTests } from '../../helpers/interact-submode-setup';

import type {
  IncrementalIndexEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';

module('Acceptance | interact submode | index changes tests', function (hooks) {
  let realm: Realm;

  setupInteractSubmodeTests(hooks, {
    setRealm(value) {
      realm = value;
    },
  });

  module('index changes', function () {
    test('stack item live updates when index changes', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
        .hasText('Fadhlan');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              firstName: 'FadhlanXXX',
            },
            meta: {
              adoptsFrom: {
                module: rri('../person'),
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
        .hasText('FadhlanXXX');
    });

    test('stack item live updates with error in isolated mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');

      // Cause error: missing adoptsFrom module. Broken-linksTo no longer
      // demotes the consuming card, so this is the new lever for "make
      // this card error" live-update assertions.
      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: rri('../missing-person'),
                name: 'MissingPerson',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .exists('card error state is displayed');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: rri('../person'),
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');
    });

    test('stack item live shows stale card when server has an error in edit mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      });

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');
      assert.dom('[data-test-field="firstName"] input').hasValue('Fadhlan');

      // TODO should we show a message that the card is currently in an error
      // state on the server? note that this error state did not occur from an
      // auto save, but rather an external event put the server into an error...
    });

    test('stack item edit results in index event that is ignored', async function (assert) {
      assert.expect(6);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });
      const messageService = getService('message-service');
      const receivedEventDeferred = new Deferred<void>();
      const unsubscribe = messageService.subscribe(
        testRealmURL,
        (ev: RealmEventContent) => {
          // React only to the incremental index event produced by this
          // edit. File "update" events, the "incremental-index-initiation"
          // event that precedes indexing, and any from-scratch ("full") or
          // "copy" re-index of this realm all reach this listener too — the
          // re-index events carry no clientRequestId and would fail the
          // assertions below — so ignore everything that is not the single
          // incremental event under test.
          if (ev.eventName !== 'index' || ev.indexType !== 'incremental') {
            // eslint-disable-next-line qunit/no-early-return
            return;
          }
          // Stop listening once the incremental event is handled so a later
          // event can't re-run these assertions and overrun assert.expect(6).
          unsubscribe();
          ev = ev as IncrementalIndexEventContent;
          assert.ok(
            ev.clientRequestId,
            `client request ID is included in event: ${JSON.stringify(ev)}`,
          );
          assert.strictEqual(
            ev.eventName,
            'index',
            'the event name is "index"',
          );
          assert.strictEqual(
            ev.indexType,
            'incremental',
            'the event type is "incremental"',
          );
          assert.deepEqual(
            ev.invalidations,
            [`${testRealmURL}Person/fadhlan`],
            'invalidations are correct',
          ); // the card that was edited
          receivedEventDeferred.fulfill();
        },
      );
      await click('[data-test-edit-button]');
      fillIn('[data-test-field="firstName"] input', 'FadhlanXXX');
      let inputElement = find(
        '[data-test-field="firstName"] input',
      ) as HTMLInputElement;
      inputElement.focus();
      inputElement.select();
      inputElement.setSelectionRange(0, 3);
      await receivedEventDeferred.promise;
      await settled();
      inputElement = find(
        '[data-test-field="firstName"] input',
      ) as HTMLInputElement;
      assert.strictEqual(
        document.activeElement,
        inputElement,
        'focus is preserved on the input element',
      );
      assert.strictEqual(
        document.getSelection()?.anchorOffset,
        3,
        'select is preserved',
      );
    });

    test('containsMany string field preserves focus while typing', async function (assert) {
      const receivedEventDeferred = new Deferred<void>();
      const messageService = getService('message-service');
      const typedText = 'Ada';
      const inputSelector =
        '[data-test-contains-many="names"] [data-test-item="0"] input';

      const unsubscribe = messageService.subscribe(testRealmURL, (e) => {
        if (
          e.eventName === 'index' &&
          e.indexType === 'incremental-index-initiation'
        ) {
          return; // ignore the index initiation event
        }
        unsubscribe();
        receivedEventDeferred.fulfill();
      });

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}FocusTest/1`,
              format: 'edit',
            },
          ],
        ],
      });

      await click('[data-test-contains-many="names"] [data-test-add-new]');
      let inputElement = find(inputSelector) as HTMLInputElement;

      let focusStates: boolean[] = [];
      let inputEventCount = 0;
      const handleInputEvent = (event: Event) => {
        let target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        if (!target.matches(inputSelector)) {
          return;
        }
        inputEventCount += 1;
        focusStates.push(document.activeElement === target);
      };

      document.addEventListener('input', handleInputEvent, true);
      try {
        inputElement.focus();
        await typeIn(inputSelector, typedText);
      } finally {
        document.removeEventListener('input', handleInputEvent, true);
      }

      await receivedEventDeferred.promise;
      await settled();

      assert.strictEqual(
        inputEventCount,
        typedText.length,
        'input events are triggered for each keystroke',
      );
      assert.true(
        focusStates.every(Boolean),
        'focus is preserved on the input element during typing',
      );
      inputElement = find(inputSelector) as HTMLInputElement;
      assert.strictEqual(
        document.activeElement,
        inputElement,
        'focus is preserved on the input element after typing',
      );
      assert.dom(inputSelector).hasValue(typedText);
    });

    test('containsMany field def preserves focus while typing', async function (assert) {
      const messageService = getService('message-service');
      const typedText = 'Ada';
      const withoutLinksSelector =
        '[data-test-contains-many="items"] [data-test-item="0"] [data-test-field="label"] input';
      const withLinksSelector =
        '[data-test-contains-many="items"] [data-test-item="1"] [data-test-field="label"] input';

      const waitForIndexEvent = () => {
        const receivedEventDeferred = new Deferred<void>();
        const unsubscribe = messageService.subscribe(
          testRealmURL,
          (e: RealmEventContent) => {
            if (
              e.eventName === 'index' &&
              e.indexType === 'incremental-index-initiation'
            ) {
              return; // ignore the index initiation event
            }
            unsubscribe();
            receivedEventDeferred.fulfill();
          },
        );
        return receivedEventDeferred;
      };

      const assertFocusPreserved = async (
        selector: string,
        expectedValue: string,
      ) => {
        const receivedEventDeferred = waitForIndexEvent();
        let inputElement = find(selector) as HTMLInputElement;
        let focusStates: boolean[] = [];
        let inputEventCount = 0;
        const handleInputEvent = (event: Event) => {
          let target = event.target;
          if (!(target instanceof HTMLInputElement)) {
            return;
          }
          if (!target.matches(selector)) {
            return;
          }
          inputEventCount += 1;
          focusStates.push(document.activeElement === target);
        };

        document.addEventListener('input', handleInputEvent, true);
        try {
          inputElement.focus();
          inputElement.setSelectionRange(
            inputElement.value.length,
            inputElement.value.length,
          );
          await typeIn(selector, typedText);
        } finally {
          document.removeEventListener('input', handleInputEvent, true);
        }

        await receivedEventDeferred.promise;
        await settled();

        assert.strictEqual(
          inputEventCount,
          typedText.length,
          'input events are triggered for each keystroke',
        );
        assert.true(
          focusStates.every(Boolean),
          'focus is preserved on the input element during typing',
        );
        inputElement = find(selector) as HTMLInputElement;
        assert.strictEqual(
          document.activeElement,
          inputElement,
          'focus is preserved on the input element after typing',
        );
        assert.dom(selector).hasValue(expectedValue);
      };

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}FocusNested/1`,
              format: 'edit',
            },
          ],
        ],
      });

      assert.dom(withoutLinksSelector).hasValue('Plain');
      await assertFocusPreserved(withoutLinksSelector, `Plain${typedText}`);

      assert
        .dom(
          '[data-test-contains-many="items"] [data-test-item="1"] [data-test-links-to-many="pets"] [data-test-pill-item="0"]',
        )
        .exists('linksToMany field has a linked card');
      assert.dom(withLinksSelector).hasValue('With Pet');
      await assertFocusPreserved(withLinksSelector, `With Pet${typedText}`);
    });
  });

  module('size limit errors', function () {
    test('edit view shows size limit error when save exceeds limit', async function (assert) {
      let environmentService = getService('environment-service') as any;
      let originalMaxSize = environmentService.cardSizeLimitBytes;
      environmentService.cardSizeLimitBytes = 1000;

      try {
        await visitOperatorMode({
          stacks: [
            [
              {
                id: `${testRealmURL}Pet/mango`,
                format: 'edit',
              },
            ],
          ],
        });

        await fillIn(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-field="name"] input`,
          'x'.repeat(5000),
        );

        assert
          .dom(
            `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-auto-save-indicator]`,
          )
          .includesText(
            `exceeds maximum allowed size (${environmentService.cardSizeLimitBytes} bytes)`,
          );
      } finally {
        environmentService.cardSizeLimitBytes = originalMaxSize;
      }
    });
  });
});
