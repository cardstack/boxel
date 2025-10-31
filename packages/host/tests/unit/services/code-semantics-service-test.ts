import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type { Ready } from '@cardstack/host/resources/file';
import type { State } from '@cardstack/host/resources/module-contents';

import type { SaveType } from '@cardstack/host/services/card-service';
import type CodeSemanticsService from '@cardstack/host/services/code-semantics-service';

const mockFile: Ready = {
  state: 'ready',
  url: 'test://example.ts',
  content: 'export class TestClass {}',
  lastModified: Date.now().toString(),
  name: 'example.ts',
  realmURL: '',
  size: 0,
  write: function (
    _content: string,
    _opts?:
      | {
          flushLoader?: boolean | undefined;
          saveType?: SaveType | undefined;
        }
      | undefined,
  ): Promise<void> {
    throw new Error('Function not implemented.');
  },
};

module('Unit | Service | code-semantics', function (hooks) {
  setupTest(hooks);

  test('getDeclarations returns empty array when not a module', function (assert) {
    let service = this.owner.lookup(
      'service:code-semantics-service',
    ) as CodeSemanticsService;

    assert.ok(service, 'service exists');

    let declarations = service.getDeclarations(mockFile, false);
    assert.deepEqual(declarations, [], 'returns empty array when not a module');
  });

  test('getSelectedDeclaration returns undefined when not a module', function (assert) {
    let service = this.owner.lookup(
      'service:code-semantics-service',
    ) as CodeSemanticsService;

    let selectedDeclaration = service.getSelectedDeclaration(
      mockFile,
      'TestClass',
      false,
    );
    assert.strictEqual(
      selectedDeclaration,
      undefined,
      'returns undefined when not a module',
    );
  });

  test('getModuleError returns undefined when not a module', function (assert) {
    let service = this.owner.lookup(
      'service:code-semantics-service',
    ) as CodeSemanticsService;

    let moduleError = service.getModuleError(mockFile, false);
    assert.strictEqual(
      moduleError,
      undefined,
      'returns undefined when not a module',
    );
  });

  test('getIsLoading returns false when not a module', function (assert) {
    let service = this.owner.lookup(
      'service:code-semantics-service',
    ) as CodeSemanticsService;

    let isLoading = service.getIsLoading(mockFile, false);
    assert.false(isLoading, 'returns false when not a module');
  });

  test('setOnModuleEditCallback registers callback', function (assert) {
    let service = this.owner.lookup(
      'service:code-semantics-service',
    ) as CodeSemanticsService;
    let callbackCalled = false;
    let receivedState: State | null = null;

    service.setOnModuleEditCallback((state: State) => {
      callbackCalled = true;
      receivedState = state;
    });

    // Simulate module edit by calling the private method
    let testState: State = {
      url: 'test://example.ts',
      declarations: [],
    };

    // @ts-ignore accessing private method for testing
    service.handleModuleEdit(testState);

    assert.true(callbackCalled, 'callback was called');
    assert.deepEqual(
      receivedState,
      testState,
      'callback received correct state',
    );
  });

  test('service API methods handle undefined file', function (assert) {
    let service = this.owner.lookup(
      'service:code-semantics-service',
    ) as CodeSemanticsService;

    // All methods should handle undefined file gracefully
    let declarations = service.getDeclarations(undefined, true);
    service.getSelectedDeclaration(undefined, 'TestClass', true);
    service.getModuleError(undefined, true);
    service.getIsLoading(undefined, true);

    assert.ok(declarations, 'getDeclarations handles undefined file');
    assert.ok(true, 'all methods handle undefined file without error');
  });
});
