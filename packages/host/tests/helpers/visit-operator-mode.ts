import { visit } from '@ember/test-helpers';

import stringify from 'safe-stable-stringify';

import type { SerializedState } from '@cardstack/host/services/operator-mode-state-service';

export default async function visitOperatorMode({
  stacks,
  submode,
  codePath,
  codeSelection,
  fileView,
  openDirs,
  aiAssistantOpen,
  moduleInspector,
  workspaceChooserOpened,
  trail,
  cardPreviewFormat,
}: Partial<SerializedState> & { selectAllCardsFilter?: boolean }) {
  let operatorModeState = {
    stacks: stacks || [],
    submode: submode || 'interact',
    workspaceChooserOpened: workspaceChooserOpened
      ? workspaceChooserOpened
      : false,
    aiAssistantOpen: aiAssistantOpen ?? false,
    ...(codePath ? { codePath } : {}),
    ...(codeSelection ? { codeSelection } : {}),
    ...(fileView ? { fileView } : {}),
    ...(openDirs ? { openDirs } : {}),
    ...(moduleInspector ? { moduleInspector } : {}),
    ...(trail ? { trail } : {}),
    ...(cardPreviewFormat ? { cardPreviewFormat } : {}),
  };

  let operatorModeStateParam = stringify(operatorModeState)!;

  let query = new URLSearchParams({
    operatorModeState: operatorModeStateParam,
  });
  await visit(`/?${query}`);
}
