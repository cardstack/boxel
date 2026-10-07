import { generateRandomWorkspaceName } from './random-name';
import {
  getRandomBackgroundURL,
  iconURLFor,
  toWorkspaceEndpoint,
} from './utils';

import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';

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
