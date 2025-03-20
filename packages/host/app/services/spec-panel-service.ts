import Owner from '@ember/owner';
import Service from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';

import { SpecSelection } from '@cardstack/host/utils/local-storage-keys';

export default class SpecPanelService extends Service {
  @tracked specSelection?: string | null;

  constructor(owner: Owner) {
    super(owner);
    let selection = window.localStorage.getItem(SpecSelection);
    this.specSelection = selection;
  }

  setSelection = (id: string | null) => {
    this.specSelection = id;
    if (id == null) {
      window.localStorage.removeItem(SpecSelection);
    } else {
      window.localStorage.setItem(SpecSelection, id);
    }
  };
}
