import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class PersistModuleInspectorViewTool extends HostBaseTool<
  typeof BaseToolModule.PersistModuleInspectorViewInput,
  undefined
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  description = 'Persist the module inspector view selection to local storage';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { PersistModuleInspectorViewInput } = commandModule;
    return PersistModuleInspectorViewInput;
  }

  requireInputFields = ['codePath', 'moduleInspectorView'];

  protected async run(
    input: BaseToolModule.PersistModuleInspectorViewInput,
  ): Promise<undefined> {
    let view = input.moduleInspectorView;
    let allowedViews: Set<string> = new Set(['schema', 'spec', 'preview']);
    if (!allowedViews.has(view)) {
      throw new Error(
        `Invalid moduleInspectorView "${view}". Must be one of: schema, spec, preview`,
      );
    }
    this.operatorModeStateService.persistModuleInspectorView(
      input.codePath,
      view as 'schema' | 'spec' | 'preview',
    );
    return undefined;
  }
}
