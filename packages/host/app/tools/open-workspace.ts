import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type OperatorModeStateService from '../services/operator-mode-state-service';

export default class OpenWorkspaceTool extends HostBaseTool<
  typeof BaseToolModule.RealmIdentifierCard
> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Open';

  description = 'Open the main index card of a workspace.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { RealmIdentifierCard } = commandModule;
    return RealmIdentifierCard;
  }

  requireInputFields = ['realmIdentifier'];

  protected async run(
    input: BaseToolModule.RealmIdentifierCard,
  ): Promise<undefined> {
    let { realmIdentifier } = input;
    if (!realmIdentifier) {
      throw new Error('Realm identifier is required to open a workspace.');
    }

    await this.operatorModeStateService.openWorkspace(realmIdentifier);

    return undefined;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { OpenWorkspaceTool as OpenWorkspaceCommand };
