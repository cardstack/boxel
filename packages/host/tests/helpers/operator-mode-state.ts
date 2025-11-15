import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

export function setupOperatorModeStateCleanup(hooks: NestedHooks) {
  let operatorModeStateService: OperatorModeStateService | undefined;

  hooks.beforeEach(function () {
    operatorModeStateService = getService('operator-mode-state-service');
  });

  hooks.afterEach(async function () {
    await settled();
    operatorModeStateService?.resetState();
  });
}
