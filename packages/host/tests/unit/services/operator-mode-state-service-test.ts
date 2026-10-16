import { settled } from '@ember/test-helpers';
import { createCache, getValue } from '@glimmer/tracking/primitives/cache';

import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import { Deferred } from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import { StackItem } from '@cardstack/host/lib/stack-item';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import { AiAssistantOpen } from '@cardstack/host/utils/local-storage-keys';

module('Unit | Service | operator-mode-state-service', function (hooks) {
  setupTest(hooks);
  setupWindowMock(hooks);

  let service: OperatorModeStateService;

  hooks.beforeEach(function () {
    service = getService('operator-mode-state-service');
  });

  module('setItemFormat', function () {
    test('mutates an item in place; preserves identity', function (assert) {
      let item = new StackItem({
        id: 'test-card',
        format: 'isolated',
        stackIndex: 0,
      });
      let before = item;
      let request = new Deferred<string>();

      service.setItemFormat(item, 'edit', { request });

      assert.strictEqual(item, before, 'item instance preserved');
      assert.strictEqual(item.format, 'edit', 'format is mutated');
      assert.strictEqual(item.request, request, 'request is set');
    });

    test('keeps prior request and useBaseTemplate when not passed', function (assert) {
      let priorRequest = new Deferred<string>();
      let item = new StackItem({
        id: 'test-card',
        format: 'isolated',
        stackIndex: 0,
        request: priorRequest,
        useBaseTemplate: true,
      });

      service.setItemFormat(item, 'edit');

      assert.strictEqual(item.format, 'edit', 'format is mutated');
      assert.strictEqual(
        item.request,
        priorRequest,
        'request is unchanged when not passed in opts',
      );
      assert.true(
        item.useBaseTemplate,
        'useBaseTemplate is unchanged when not passed in opts',
      );
    });

    test('clears useBaseTemplate when explicitly set to undefined', function (assert) {
      let item = new StackItem({
        id: 'test-card',
        format: 'isolated',
        stackIndex: 0,
        useBaseTemplate: true,
      });

      service.setItemFormat(item, 'edit', { useBaseTemplate: undefined });

      assert.strictEqual(item.useBaseTemplate, undefined);
    });

    test('no-ops on file items', function (assert) {
      let item = new StackItem({
        id: 'test-file',
        format: 'isolated',
        stackIndex: 0,
        type: 'file',
      });

      service.setItemFormat(item, 'edit');

      assert.strictEqual(
        item.format,
        'isolated',
        'file items are not mutated by setItemFormat',
      );
    });
  });

  test('openAiAssistant / closeAiAssistant persist preference to localStorage', function (assert) {
    service.openAiAssistant();
    assert.strictEqual(
      window.localStorage.getItem(AiAssistantOpen),
      'true',
      'open writes true',
    );
    service.closeAiAssistant();
    assert.strictEqual(
      window.localStorage.getItem(AiAssistantOpen),
      'false',
      'close writes false',
    );
  });

  test('URL aiAssistantOpen=true wins over localStorage=false', function (assert) {
    window.localStorage.setItem(AiAssistantOpen, 'false');
    service.restore({ stacks: [], aiAssistantOpen: true });
    assert.true(
      service.aiAssistantOpen,
      'explicit true in URL overrides persisted closed preference',
    );
  });

  test('URL aiAssistantOpen=false wins over localStorage=true', function (assert) {
    window.localStorage.setItem(AiAssistantOpen, 'true');
    service.restore({ stacks: [], aiAssistantOpen: false });
    assert.false(
      service.aiAssistantOpen,
      'explicit false in URL overrides persisted open preference',
    );
  });

  test('URL with no aiAssistantOpen key falls back to localStorage (closed)', function (assert) {
    window.localStorage.setItem(AiAssistantOpen, 'false');
    service.restore({ stacks: [] });
    assert.false(
      service.aiAssistantOpen,
      'panel stays closed when URL state omits the key and localStorage says closed',
    );
  });

  test('URL with no aiAssistantOpen key falls back to localStorage (remembered open)', function (assert) {
    window.localStorage.setItem(AiAssistantOpen, 'true');
    service.restore({ stacks: [] });
    assert.true(
      service.aiAssistantOpen,
      'panel reopens when URL state omits the key but localStorage remembers open',
    );
  });

  test('closed by default when neither URL nor localStorage carry a preference', function (assert) {
    // no localStorage seeded — first-ever visit
    service.restore({ stacks: [] });
    assert.false(
      service.aiAssistantOpen,
      'panel stays closed by default when neither URL nor localStorage carry a preference',
    );
  });

  test('resetState rereads persisted preference (logout/login cycle)', function (assert) {
    window.localStorage.setItem(AiAssistantOpen, 'false');
    service.resetState();
    assert.false(
      service.aiAssistantOpen,
      'after reset, panel respects persisted closed preference',
    );
  });

  test('expanded stack item is serialized and restored', function (assert) {
    let item = new StackItem({
      id: 'https://example.com/cards/1',
      format: 'isolated',
      stackIndex: 0,
    });

    service.addItemToStack(item);
    service.setStackItemExpanded(item, true);

    let rawState = JSON.parse(service.serialize());
    assert.deepEqual(
      rawState.expandedStackItem,
      {
        id: 'https://example.com/cards/1',
        stackIndex: 0,
      },
      'expanded item identity is included in serialized state',
    );

    service.resetState();
    service.restore(rawState);

    let restoredItem = service.state.stacks[0][0];
    assert.true(
      service.isStackItemExpanded(restoredItem),
      'expanded state is restored onto the rebuilt stack item',
    );
  });

  module('on a phone-width viewport', function (hooks) {
    let first: StackItem;
    let second: StackItem;

    hooks.beforeEach(function () {
      service.isMobileViewport = true;
      first = new StackItem({
        id: 'https://example.com/cards/1',
        format: 'isolated',
        stackIndex: 0,
      });
      second = new StackItem({
        id: 'https://example.com/cards/2',
        format: 'isolated',
        stackIndex: 0,
      });
      service.addItemToStack(first);
      service.addItemToStack(second);
    });

    test('cards in the first stack are always expanded', function (assert) {
      let neighbor = new StackItem({
        id: 'https://example.com/cards/3',
        format: 'isolated',
        stackIndex: 1,
      });
      service.addItemToStack(neighbor);

      assert.true(service.isStackItemExpanded(first));
      assert.true(service.isStackItemExpanded(second));
      assert.false(
        service.isStackItemExpanded(neighbor),
        'the hidden second stack is not expanded',
      );
      assert.true(service.hasAnyStackItemExpanded);

      service.isMobileViewport = false;
      assert.false(
        service.isStackItemExpanded(second),
        'a wider viewport restores the normal width',
      );
      assert.false(service.hasAnyStackItemExpanded);
    });

    test('a card expanded in the hidden second stack stays collapsed', function (assert) {
      let neighbor = new StackItem({
        id: 'https://example.com/cards/3',
        format: 'isolated',
        stackIndex: 1,
      });
      service.addItemToStack(neighbor);
      service.setStackItemExpanded(neighbor, true);

      assert.false(service.isStackItemExpanded(neighbor));
      assert.true(service.isStackItemExpanded(second));
    });

    test('cards are not expanded outside interact mode', async function (assert) {
      // Let the setup's persist run in interact mode first; in code mode it
      // loads the open file, which unit tests can't do.
      await settled();
      service.restore({
        stacks: [[{ id: 'https://example.com/cards/1', format: 'isolated' }]],
        submode: Submodes.Code,
      });
      let [item] = service.state.stacks[0];

      assert.false(service.isStackItemExpanded(item));
      assert.false(service.hasAnyStackItemExpanded);
    });

    test('closing the first stack expands the stack that takes its place', function (assert) {
      let neighbor = new StackItem({
        id: 'https://example.com/cards/3',
        format: 'isolated',
        stackIndex: 1,
      });
      service.addItemToStack(neighbor);
      let expanded = createCache(() => service.isStackItemExpanded(neighbor));
      assert.false(getValue(expanded));

      service.trimItemsFromStack(first);

      assert.true(
        getValue(expanded),
        'the cached value is invalidated when the stacks shift',
      );
    });

    test('the phone layout is not serialized as an expanded item', function (assert) {
      let rawState = JSON.parse(service.serialize());
      assert.strictEqual(rawState.expandedStackItem, undefined);
    });
  });
});
