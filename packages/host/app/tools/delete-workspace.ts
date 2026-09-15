import { service } from '@ember/service';

import { RealmPaths, ensureTrailingSlash, ri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import { publishedRealmURLsFromInfo } from '../lib/utils';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RecentFilesService from '../services/recent-files-service';
import type * as BaseToolModule from '@cardstack/base/command';

// Deletes a workspace (realm) the current user owns, with the same result as
// "Delete Workspace" in the workspace chooser tile menu: the realm and all of
// its content are removed on the realm server (published copies included), it
// leaves the user's realm list, and the app falls back to the workspace
// chooser if the deleted workspace — or one of its published copies — was
// the one being viewed.
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
    // The identifier may be a scoped form (`@cardstack/base/`) rather than a
    // URL, so it is never handed to `new URL()`; RealmPaths and the realm
    // services accept either form.
    let realmURL = ensureTrailingSlash(input.realmIdentifier);
    if (!this.realm.isRealmOwner(realmURL)) {
      throw new Error(
        `Cannot delete workspace ${realmURL}: the current user is not its owner.`,
      );
    }

    // The realm server removes the workspace's published copies along with
    // it, so they are cleaned up here the same way.
    let publishedRealmURLs = publishedRealmURLsFromInfo(
      this.realm.info(realmURL),
    );
    let deletedRealmURLs = [realmURL, ...publishedRealmURLs];
    let isActiveWorkspace = deletedRealmURLs.some((url) => {
      let realmPath = new RealmPaths(ri(url));
      return (
        this.operatorModeStateService.realmURL === url ||
        this.operatorModeStateService
          .getOpenCardIds()
          .some((cardId) => realmPath.inRealm(cardId)) ||
        Boolean(this.operatorModeStateService.codePathString?.startsWith(url))
      );
    });

    await this.realmServer.deleteRealm(realmURL);
    await this.matrixService.removeRealmFromAccountData(realmURL);
    for (let url of deletedRealmURLs) {
      this.recentFilesService.removeRecentFilesForRealmURL(url);
    }
    this.realm.removeRealm(realmURL);

    if (isActiveWorkspace) {
      this.operatorModeStateService.clearStacks();
      await this.operatorModeStateService.updateCodePath(null);
      this.operatorModeStateService.openWorkspaceChooser();
    }

    return undefined;
  }
}
