import Service from '@ember/service';

import { isTesting } from '@embroider/macros';

interface Resettable {
  resetState(): void;
}

export default class ResetService extends Service {
  private resettables: Resettable[] = [];

  register(resettable: Resettable) {
    this.resettables.push(resettable);
  }

  resetAll() {
    if (isTesting()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[RESET-DIAG] resetAll() called\n${new Error().stack ?? '(no stack)'}`,
      );
    }
    for (let resettable of this.resettables) {
      resettable.resetState();
    }
  }
}
