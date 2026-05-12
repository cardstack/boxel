import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class OpenWorkspaceCommand extends HostBaseCommand<
  typeof BaseCommandModule.RealmIdentifierCard
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Open';

  description = 'Open the main index card of a workspace.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RealmIdentifierCard } = commandModule;
    return RealmIdentifierCard;
  }

  requireInputFields = ['realmUrl'];

  protected async run(
    input: BaseCommandModule.RealmIdentifierCard,
  ): Promise<undefined> {
    let { realmUrl } = input;
    if (!realmUrl) {
      throw new Error('Realm identifier is required to open a workspace.');
    }

    await this.operatorModeStateService.openWorkspace(realmUrl);

    return undefined;
  }
}
