/* eslint-disable window-mock/wrapped-setup-helpers-only */
// This is the one place we allow these to be used directly.

import {
  setupApplicationTest as emberSetupApplicationTest,
  setupRenderingTest as emberSetupRenderingTest,
} from 'ember-qunit';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { cleanupMonacoEditorModels } from './index';

export function setupApplicationTest(hooks: NestedHooks) {
  emberSetupApplicationTest(hooks);
  setupWindowMock(hooks);
  hooks.afterEach(cleanupMonacoEditorModels);
}

export function setupRenderingTest(hooks: NestedHooks) {
  emberSetupRenderingTest(hooks);
  setupWindowMock(hooks);
  hooks.afterEach(cleanupMonacoEditorModels);
}
