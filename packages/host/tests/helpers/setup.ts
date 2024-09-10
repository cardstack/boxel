import {
  setupApplicationTest as emberSetupApplicationTest,
  setupRenderingTest as emberSetupRenderingTest,
} from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';

export function setupApplicationTest(hooks: NestedHooks) {
  emberSetupApplicationTest(hooks);
  setupWindowMock(hooks);
}

export function setupRenderingTest(hooks: NestedHooks) {
  emberSetupRenderingTest(hooks);
  setupWindowMock(hooks);
}
