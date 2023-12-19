import { visit } from '@ember/test-helpers';

import stringify from 'safe-stable-stringify';

import { SerializedState } from '@cardstack/host/services/operator-mode-state-service';

export default async function visitOperatorMode({
  stacks,
  submode,
  codePath,
  fileView,
  openDirs,
}: Partial<SerializedState>) {
  let operatorModeState = {
    stacks: stacks || [],
    submode: submode || 'interact',
    ...(codePath ? { codePath } : {}),
    ...(fileView ? { fileView } : {}),
    ...(openDirs ? { openDirs } : {}),
  };

  let operatorModeStateParam = stringify(operatorModeState)!;

  await visit(
    `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
      operatorModeStateParam,
    )}`,
  );
}
