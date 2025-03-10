import Owner from '@ember/owner';
import Service from '@ember/service';
import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';
import { TrackedObject } from 'tracked-built-ins';
import window from 'ember-window-mock';
import { Format } from 'https://cardstack.com/base/card-api';

export default class PlaygroundPanelService extends Service {
  private playgroundSelections: Record<
    string, // moduleId
    { cardId: string; format: Format }
  >;

  constructor(owner: Owner) {
    super(owner);
    let selections = window.localStorage.getItem(PlaygroundSelections);

    this.playgroundSelections = new TrackedObject(
      selections?.length ? JSON.parse(selections) : {},
    );
  }

  persistSelections = (moduleId: string, cardId: string, format: Format) => {
    this.playgroundSelections[moduleId] = { cardId, format };
    window.localStorage.setItem(
      PlaygroundSelections,
      JSON.stringify(this.playgroundSelections),
    );
  };

  getSelection = (moduleId: string) => {
    return this.playgroundSelections[moduleId];
  };
}
