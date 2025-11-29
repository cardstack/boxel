import { click } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import window from 'ember-window-mock';

import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type { PlaygroundSelection } from '@cardstack/host/services/playground-panel-service';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';
import {
  PlaygroundSelections,
  SpecSelection,
} from '@cardstack/host/utils/local-storage-keys';

import type { Format } from 'https://cardstack.com/base/card-api';

import { testRealmURL, visitOperatorMode } from './index';

export type { Format, PlaygroundSelection };

export const assertCardExists = (
  assert: Assert,
  cardId: string,
  format?: Format,
  message?: string,
) => {
  let selector = `[data-test-playground-panel] [data-test-card="${cardId}"]`;
  if (format) {
    selector += `[data-test-card-format="${format}"]`;
  }
  assert.dom(selector).exists(message);
};

export const assertFieldExists = (
  assert: Assert,
  format: Format,
  message?: string,
) =>
  assert
    .dom(
      `[data-test-field-preview-card] [data-test-compound-field-format="${format}"]`,
    )
    .exists(message);

export const chooseAnotherInstance = async () => {
  await click('[data-test-instance-chooser]');
  await click('[data-test-boxel-menu-item-text="Choose another instance"]');
};

export const createNewInstance = async () => {
  await click('[data-test-instance-chooser]');
  await click('[data-test-boxel-menu-item-text="Create new instance"]');
};

export const openFileInPlayground = async (
  filePath: string,
  realmURL = testRealmURL,
  opts?: { declaration?: string; codeSelection?: string },
) => {
  await visitOperatorMode({
    submode: 'code',
    codePath: `${realmURL}${filePath}`,
    ...(opts?.codeSelection ? { codeSelection: opts.codeSelection } : {}),
  });
  if (opts?.declaration) {
    await selectDeclaration(opts.declaration);
  }
  await togglePlaygroundPanel();
};

export const selectDeclaration = async (name: string) =>
  await click(
    `[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="${name}"]`,
  );

export const selectFormat = async (format: Format) =>
  await click(`[data-test-format-chooser="${format}"]`);

export const togglePlaygroundPanel = async () =>
  await click('[data-test-module-inspector-view="preview"]');

export const toggleSpecPanel = async () =>
  await click('[data-test-module-inspector-view="spec"]');

// PlaygroundSelections
export function getPlaygroundSelections(): Record<
  string,
  PlaygroundSelection
> | null {
  let selections = window.localStorage.getItem(PlaygroundSelections);
  if (!selections) {
    return null;
  }
  return JSON.parse(selections);
}

export function setPlaygroundSelections(
  selections: Record<string, PlaygroundSelection>,
) {
  window.localStorage.setItem(PlaygroundSelections, JSON.stringify(selections));
}

export function removePlaygroundSelections() {
  window.localStorage.removeItem(PlaygroundSelections);
  try {
    let service = getService('playground-panel-service') as
      | PlaygroundPanelService
      | undefined;
    service?.resetSelections();
  } catch (_err) {
    // service may not be registered yet (e.g. before app boot); ignore
  }
}

export function removeSpecSelection() {
  window.localStorage.removeItem(SpecSelection);
  try {
    let service = getService('spec-panel-service') as
      | SpecPanelService
      | undefined;
    service?.resetSelection();
  } catch (_err) {
    // service may not be registered yet
  }
}
