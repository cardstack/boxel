import { visit } from '@ember/test-helpers';

import stringify from 'safe-stable-stringify';

import { SerializedState } from '@cardstack/host/services/operator-mode-state-service';

export default async function visitOperatorMode({
  stacks,
  submode,
  codePath,
  fileView,
  openDirs,
  moduleInspector,
  workspaceChooserOpened,
}: Partial<SerializedState>) {
  let operatorModeState = {
    stacks: stacks || [],
    submode: submode || 'interact',
    workspaceChooserOpened: workspaceChooserOpened
      ? workspaceChooserOpened
      : false,
    ...(codePath ? { codePath } : {}),
    ...(fileView ? { fileView } : {}),
    ...(openDirs ? { openDirs } : {}),
    ...(moduleInspector ? { moduleInspector } : {}),
  };

  let operatorModeStateParam = stringify(operatorModeState)!;

  await visit(
    `/?&operatorModeState=${encodeURIComponent(operatorModeStateParam)}`,
  );
}
