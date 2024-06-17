import { visit, waitFor } from '@ember/test-helpers';

import stringify from 'safe-stable-stringify';

import { time } from '@cardstack/runtime-common/helpers/time';

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

  await time('visitOperatorMode:visit', async () => {
    return await visit(
      `/?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        operatorModeStateParam,
      )}`,
    );
  });

  if (stacks && stacks.length > 0 && (!submode || submode === 'interact')) {
    await time('visitOperatorMode:waitFor', async () => {
      return await waitFor('[data-test-operator-mode-stack]');
    });
  }
}
