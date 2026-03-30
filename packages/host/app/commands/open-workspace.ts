import { inject as service } from '@ember/service';

import HostBaseCommand from '../lib/host-base-command';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type * as BaseCommandModule from '@cardstack/base/command';

export default class OpenWorkspaceCommand extends HostBaseCommand<
  typeof BaseCommandModule.RealmUrlCard
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Open';

  description = 'Open the main index card of a workspace.';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RealmUrlCard } = commandModule;
    return RealmUrlCard;
  }

  requireInputFields = ['realmUrl'];

  protected async run(
    input: BaseCommandModule.RealmUrlCard,
  ): Promise<undefined> {
    let { realmUrl } = input;
    if (!realmUrl) {
      throw new Error('Realm URL is required to open a workspace.');
    }

    await this.operatorModeStateService.openWorkspace(realmUrl);

    return undefined;
  }
}
