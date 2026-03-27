import type Owner from '@ember/owner';
import Service from '@ember/service';
import { service } from '@ember/service';

import type { BoxelErrorForContext } from 'https://cardstack.com/base/matrix-event';

import type ResetService from './reset';

export interface DisplayedErrorProvider {
  getError: () => BoxelErrorForContext;
}

export default class ErrorDisplayService extends Service {
  @service declare reset: ResetService;
  errorProviders: Set<DisplayedErrorProvider> = new Set();

  constructor(owner: Owner) {
    super(owner);
    this.reset.register(this);
  }

  resetState() {
    this.errorProviders.clear();
  }

  register(errorProvider: DisplayedErrorProvider) {
    this.errorProviders.add(errorProvider);
  }
  unregister(errorProvider: DisplayedErrorProvider) {
    this.errorProviders.delete(errorProvider);
  }

  getDisplayedErrors() {
    return [...this.errorProviders].map((provider) => provider.getError());
  }
}

declare module '@ember/service' {
  interface Registry {
    'error-display': ErrorDisplayService;
  }
}
