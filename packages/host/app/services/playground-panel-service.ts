import Owner from '@ember/owner';
import Service from '@ember/service';

import window from 'ember-window-mock';
import { TrackedObject } from 'tracked-built-ins';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import { Format } from 'https://cardstack.com/base/card-api';

export interface PlaygroundSelection {
  cardId: string;
  format: Format;
  fieldIndex?: number;
}

export default class PlaygroundPanelService extends Service {
  private playgroundSelections: Record<string, PlaygroundSelection>; // TrackedObject<moduleId, PlaygroundSelection>

  constructor(owner: Owner) {
    super(owner);
    let selections = window.localStorage.getItem(PlaygroundSelections);

    this.playgroundSelections = new TrackedObject(
      selections?.length ? JSON.parse(selections) : {},
    );
  }

  persistSelections = (
    moduleId: string,
    cardId: string,
    format: Format,
    fieldIndex: number | undefined,
  ) => {
    this.playgroundSelections[moduleId] = { cardId, format, fieldIndex };
    this.setStorage();
  };

  setStorage = () => {
    window.localStorage.setItem(
      PlaygroundSelections,
      JSON.stringify(this.playgroundSelections),
    );
  };

  getSelection = (moduleId: string) => {
    return this.playgroundSelections[moduleId];
  };

  removeSelectionsByCardId = (cardId: string) => {
    let foundItems = Object.entries(this.playgroundSelections).filter(
      ([_key, val]) => val.cardId === cardId,
    );
    if (foundItems.length) {
      foundItems.map((item) => delete this.playgroundSelections[item[0]]);
      this.setStorage();
    }
  };
}
