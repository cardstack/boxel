import { RealmPaths, ensureTrailingSlash, ri } from '@cardstack/runtime-common';

import { generateRandomWorkspaceName } from './random-name';
import {
  getRandomBackgroundURL,
  iconURLFor,
  publishedRealmURLsFromInfo,
  toWorkspaceEndpoint,
} from './utils';

import type MatrixService from '../services/matrix-service';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RecentFilesService from '../services/recent-files-service';

// Creates a workspace (realm) owned by the current user, the same way the
// "New Workspace" tile in the workspace chooser does: the realm is created on
// the user's realm server and recorded in the user's realm list, so it shows
// up in the chooser right away. Both the create-workspace tool and
// `realm.workspaces.create` in run-realm-code come through here.
export async function createWorkspace(
  services: { matrixService: MatrixService; realm: RealmService },
  input: { name?: string | null; endpoint?: string | null },
): Promise<{ url: string; name: string }> {
  let name = input.name?.trim() || generateRandomWorkspaceName();
  // The server accepts only lowercase letters, digits and hyphens in an
  // endpoint. Normalize whatever was given (or the name) into that shape
  // rather than rejecting near-misses like "My Workspace".
  let endpoint = toWorkspaceEndpoint(input.endpoint?.trim() || name);
  if (!endpoint) {
    throw new Error(
      `Cannot derive a workspace endpoint from '${input.endpoint ?? name}'. Provide an endpoint made of letters, digits and hyphens.`,
    );
  }

  let realmURL = await services.matrixService.createPersonalRealmForUser({
    endpoint,
    name,
    iconURL: iconURLFor(name),
    backgroundURL: getRandomBackgroundURL(),
  });

  // Register the new realm with the realm service before anything opens it.
  // The context sent with a tool result names the current workspace by
  // looking the open card's realm up there; a realm it has not met yet
  // resolves to the previous workspace, and the assistant would report the
  // wrong URL. The realm exists by now, so a failure here is a transient
  // info fetch problem and must not fail a creation that succeeded.
  try {
    await services.realm.ensureRealmMeta(realmURL.href);
  } catch (error) {
    console.warn(
      `Could not load realm info for new workspace ${realmURL.href}`,
      error,
    );
  }
  return { url: realmURL.href, name };
}

// Deletes a workspace (realm) the current user owns, with the same result as
// "Delete Workspace" in the workspace chooser tile menu: the realm and all of
// its content are removed on the realm server (published copies included), it
// leaves the user's realm list, and the app falls back to the workspace
// chooser if the deleted workspace — or one of its published copies — was
// the one being viewed. Both the delete-workspace tool and
// `realm.workspaces.delete` in run-realm-code come through here, and both
// run only after the user's click.
export async function deleteWorkspace(
  services: {
    matrixService: MatrixService;
    operatorModeStateService: OperatorModeStateService;
    realm: RealmService;
    realmServer: RealmServerService;
    recentFilesService: RecentFilesService;
  },
  realmIdentifier: string,
): Promise<{ url: string }> {
  let {
    matrixService,
    operatorModeStateService,
    realm,
    realmServer,
    recentFilesService,
  } = services;
  // The identifier may be a scoped form (`@cardstack/base/`) rather than a
  // URL, so it is never handed to `new URL()`; RealmPaths and the realm
  // services accept either form.
  let realmURL = ensureTrailingSlash(realmIdentifier);
  if (!realm.isRealmOwner(realmURL)) {
    throw new Error(
      `Cannot delete workspace ${realmURL}: the current user is not its owner.`,
    );
  }

  // The realm server removes the workspace's published copies along with
  // it, so they are cleaned up here the same way.
  let publishedRealmURLs = publishedRealmURLsFromInfo(realm.info(realmURL));
  let deletedRealmURLs = [realmURL, ...publishedRealmURLs];
  let isActiveWorkspace = deletedRealmURLs.some((url) => {
    let realmPath = new RealmPaths(ri(url));
    return (
      operatorModeStateService.realmURL === url ||
      operatorModeStateService
        .getOpenCardIds()
        .some((cardId) => realmPath.inRealm(cardId)) ||
      Boolean(operatorModeStateService.codePathString?.startsWith(url))
    );
  });

  await realmServer.deleteRealm(realmURL);
  await matrixService.removeRealmFromAccountData(realmURL);
  for (let url of deletedRealmURLs) {
    recentFilesService.removeRecentFilesForRealmURL(url);
  }
  realm.removeRealm(realmURL);

  if (isActiveWorkspace) {
    operatorModeStateService.clearStacks();
    await operatorModeStateService.updateCodePath(null);
    operatorModeStateService.openWorkspaceChooser();
  }
  return { url: realmURL };
}
