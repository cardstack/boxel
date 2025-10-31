import Service from '@ember/service';

import type { BoxelErrorForContext } from 'https://cardstack.com/base/matrix-event';

export interface DisplayedErrorProvider {
  getError: () => BoxelErrorForContext;
}

export default class ErrorDisplayService extends Service {
  errorProviders: Set<DisplayedErrorProvider> = new Set();
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
