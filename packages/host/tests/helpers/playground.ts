import { click } from '@ember/test-helpers';

import window from 'ember-window-mock';

import type { PlaygroundSelection } from '@cardstack/host/services/playground-panel-service';
import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

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
  await click('[data-test-choose-another-instance]');
};

export const createNewInstance = async () => {
  await click('[data-test-instance-chooser]');
  await click('[data-test-create-instance]');
};

export const openFileInPlayground = async (
  filePath: string,
  realmURL = testRealmURL,
  declaration?: string,
) => {
  await visitOperatorMode({
    submode: 'code',
    codePath: `${realmURL}${filePath}`,
  });
  if (declaration) {
    await selectDeclaration(declaration);
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
  await click('[data-test-accordion-item="playground"] button');

export const toggleSpecPanel = async () =>
  await click('[data-test-accordion-item="spec-preview"] button');

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
}
