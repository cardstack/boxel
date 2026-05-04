import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { Deferred } from '@cardstack/runtime-common';

import { StackItem } from '@cardstack/host/lib/stack-item';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

module('Unit | Service | operator-mode-state-service', function (hooks) {
  setupTest(hooks);

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
});
