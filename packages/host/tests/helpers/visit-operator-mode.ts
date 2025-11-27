import { visit } from '@ember/test-helpers';

import stringify from 'safe-stable-stringify';

import type { SerializedState } from '@cardstack/host/services/operator-mode-state-service';
import { getService } from '@universal-ember/test-support';

export default async function visitOperatorMode({
  stacks,
  submode,
  codePath,
  fileView,
  openDirs,
  aiAssistantOpen,
  moduleInspector,
  workspaceChooserOpened,
  trail,
}: Partial<SerializedState> & { selectAllCardsFilter?: boolean }) {
  // In the host test, we can treat the visit operator mode as a full page refresh.
  // This allows us to reset the state and avoid version-conflict issues during host testing.
  let operatorModeStateService = getService('operator-mode-state-service');
  operatorModeStateService.resetState();

  let operatorModeState = {
    stacks: stacks || [],
    submode: submode || 'interact',
    workspaceChooserOpened: workspaceChooserOpened
      ? workspaceChooserOpened
      : false,
    aiAssistantOpen: aiAssistantOpen ?? false,
    ...(codePath ? { codePath } : {}),
    ...(fileView ? { fileView } : {}),
    ...(openDirs ? { openDirs } : {}),
    ...(moduleInspector ? { moduleInspector } : {}),
    ...(trail ? { trail } : {}),
  };

  let operatorModeStateParam = stringify(operatorModeState)!;

  await visit(
    `/?&operatorModeState=${encodeURIComponent(operatorModeStateParam)}`,
  );
}
