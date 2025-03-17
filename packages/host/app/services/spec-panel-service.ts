import Owner from '@ember/owner';
import Service from '@ember/service';

import window from 'ember-window-mock';

import { SpecSelection } from '@cardstack/host/utils/local-storage-keys';

import { tracked } from '@glimmer/tracking';

export default class SpecPanelService extends Service {
  @tracked specSelection?: string | null;

  constructor(owner: Owner) {
    super(owner);
    let selection = window.localStorage.getItem(SpecSelection);
    this.specSelection = selection;
  }

  setSelection = (id: string) => {
    this.specSelection = id;
    window.localStorage.setItem(SpecSelection, id);
  };
}
