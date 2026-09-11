import { service } from '@ember/service';

import { RealmPaths, ensureTrailingSlash } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RecentFilesService from '../services/recent-files-service';
import type * as BaseToolModule from '@cardstack/base/command';

// Deletes a workspace (realm) the current user owns, with the same result as
// "Delete Workspace" in the workspace chooser tile menu: the realm and all of
// its content are removed on the realm server, it leaves the user's realm
// list, and the app falls back to the workspace chooser if the deleted
// workspace was the one being viewed.
export default class DeleteWorkspaceTool extends HostBaseTool<
  typeof BaseToolModule.RealmIdentifierCard,
  typeof BaseToolModule.DeleteWorkspaceResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  @service declare private recentFilesService: RecentFilesService;

  static actionVerb = 'Delete';

  description =
    'Permanently delete a workspace (realm) owned by the current user, including all of its cards and files. This cannot be undone. Only realms the user owns can be deleted.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.RealmIdentifierCard;
  }

  requireInputFields = ['realmIdentifier'];

  protected async run(
    input: BaseToolModule.RealmIdentifierCard,
  ): Promise<BaseToolModule.DeleteWorkspaceResult> {
    let commandModule = await this.loadToolModule();
    let { DeleteWorkspaceResult } = commandModule;

    if (!input.realmIdentifier) {
      throw new Error('Realm identifier is required to delete a workspace.');
    }
    let realmURL = ensureTrailingSlash(input.realmIdentifier);
    if (!this.realm.isRealmOwner(realmURL)) {
      throw new Error(
        `Cannot delete workspace ${realmURL}: the current user is not its owner.`,
      );
    }

    let realmPath = new RealmPaths(new URL(realmURL));
    let isActiveWorkspace =
      this.operatorModeStateService.realmURL === realmURL ||
      this.operatorModeStateService
        .getOpenCardIds()
        .some((cardId) => realmPath.inRealm(cardId)) ||
      Boolean(
        this.operatorModeStateService.codePathString?.startsWith(realmURL),
      );

    await this.realmServer.deleteRealm(realmURL);
    await this.matrixService.removeRealmFromAccountData(realmURL);
    this.recentFilesService.removeRecentFilesForRealmURL(realmURL);
    this.realm.removeRealm(realmURL);

    if (isActiveWorkspace) {
      this.operatorModeStateService.clearStacks();
      await this.operatorModeStateService.updateCodePath(null);
      this.operatorModeStateService.openWorkspaceChooser();
    }

    return new DeleteWorkspaceResult({ realmURL });
  }
}
