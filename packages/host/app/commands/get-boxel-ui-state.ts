import { inject as service } from '@ember/service';

import { GetBoxelUIStateResult } from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class GetBoxelUIStateCommand extends HostBaseCommand<
  undefined,
  typeof GetBoxelUIStateResult
> {
  @service declare operatorModeStateService: OperatorModeStateService;
  static displayName = 'GetBoxelUIStateCommand';
  description =
    'Get information about the current state of the Boxel UI, including the current submode, what cards are open, and what room, if any, the AI assistant is showing.';
  async getInputType() {
    return undefined;
  }
  protected async run() {
    let commandModule = await this.loadCommandModule();
    const { GetBoxelUIStateResult } = commandModule;
    return new GetBoxelUIStateResult({
      submode: this.operatorModeStateService.state.submode,
    });
  }
}
