import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class PersistModuleInspectorViewCommand extends HostBaseCommand<
  typeof BaseCommandModule.PersistModuleInspectorViewInput,
  undefined
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description = 'Persist the module inspector view selection to local storage';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { PersistModuleInspectorViewInput } = commandModule;
    return PersistModuleInspectorViewInput;
  }

  requireInputFields = ['codePath', 'moduleInspectorView'];

  protected async run(
    input: BaseCommandModule.PersistModuleInspectorViewInput,
  ): Promise<undefined> {
    this.operatorModeStateService.persistModuleInspectorView(
      input.codePath,
      input.moduleInspectorView as 'schema' | 'spec' | 'preview',
    );
    return undefined;
  }
}
