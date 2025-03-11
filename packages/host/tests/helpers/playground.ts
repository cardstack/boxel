import { click } from '@ember/test-helpers';

import window from 'ember-window-mock';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import type { PlaygroundSelection } '@cardstack/host/services/playground-panel-service';

export async function selectDeclaration(name: string) {
  await click(
    `[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="${name}"]`,
  );
}

export function getPlaygroundSelections(): Record<string, PlaygroundSelection> | undefined {
  let selections = window.localStorage.getItem(PlaygroundSelections);
  if (!selections) {
    return;
  }
  return JSON.parse(selections);
};
