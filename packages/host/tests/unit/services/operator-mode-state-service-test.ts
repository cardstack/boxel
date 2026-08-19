import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import window from 'ember-window-mock';
import { setupWindowMock } from 'ember-window-mock/test-support';
import { module, test } from 'qunit';

import { Deferred } from '@cardstack/runtime-common';

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
    service.setStackItemExpanded(item.instanceId, true);

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
      service.isStackItemExpanded(restoredItem.instanceId),
      'expanded state is restored onto the rebuilt stack item',
    );
  });
});
