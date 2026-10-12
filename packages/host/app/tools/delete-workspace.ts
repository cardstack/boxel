import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import { deleteWorkspace } from '../lib/workspaces';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RecentFilesService from '../services/recent-files-service';
import type * as BaseToolModule from '@cardstack/base/command';

// Deletes a workspace (realm) the current user owns (see `deleteWorkspace`).
export default class DeleteWorkspaceTool extends HostBaseTool<
  typeof BaseToolModule.RealmIdentifierCard,
  undefined
> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  @service declare private recentFilesService: RecentFilesService;

  static actionVerb = 'Delete';

  // Deleting a realm destroys everything in it and cannot be undone. The
  // chooser asks the user to confirm after showing what the workspace holds;
  // this tool asks the same way: it always waits for the user's click, even
  // in a mode that runs other tools on its own.
  static neverAutoExecutes = true;

  description =
    'Permanently delete a workspace (realm) owned by the current user, including all of its cards and files. This cannot be undone. Only realms the user owns can be deleted.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.RealmIdentifierCard;
  }

  requireInputFields = ['realmIdentifier'];

  protected async run(
    input: BaseToolModule.RealmIdentifierCard,
  ): Promise<undefined> {
    if (!input.realmIdentifier) {
      throw new Error('Realm identifier is required to delete a workspace.');
    }
    await deleteWorkspace(
      {
        matrixService: this.matrixService,
        operatorModeStateService: this.operatorModeStateService,
        realm: this.realm,
        realmServer: this.realmServer,
        recentFilesService: this.recentFilesService,
      },
      input.realmIdentifier,
    );
    return undefined;
  }
}
