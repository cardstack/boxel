import { ri } from '@cardstack/runtime-common';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

const READING_LIST_CARD =
  'a card to track my reading list, with a title, author, status and rating for each book.';

// What the prompt box starts with when the dashboard opens a new session:
// something the assistant builds well in one go. On the dashboard the
// assistant has no current workspace, so the prompt names the one the user
// was last in, when they can build there.
export function aiStarterPrompt(
  realm: RealmService,
  operatorModeStateService: OperatorModeStateService,
): string {
  let openRealmURL = operatorModeStateService.openRealmURL;
  let workspace = openRealmURL ? ri(openRealmURL) : undefined;
  let name =
    workspace && realm.canWrite(workspace) && realm.isInfoLoaded(workspace)
      ? realm.info(workspace).name
      : undefined;
  return name
    ? `In ${name}, build me ${READING_LIST_CARD}`
    : `Build me ${READING_LIST_CARD}`;
}
