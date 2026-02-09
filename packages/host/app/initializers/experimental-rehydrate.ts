import type Application from '@ember/application';

// @ts-expect-error - glimmer internals not typed for direct import
import { clientBuilder, rehydrationBuilder } from '@glimmer/runtime';

declare const FastBoot: unknown;

export function initialize(application: Application): void {
  // Don't override in FastBoot (server-side) — let Ember's default serialize mode work
  if (typeof FastBoot !== 'undefined') {
    return;
  }

  application.register('service:-dom-builder', {
    create() {
      if (
        typeof document !== 'undefined' &&
        document.getElementById('fastboot-body-start')
      ) {
        return rehydrationBuilder.bind(null);
      }
      return clientBuilder.bind(null);
    },
  });
}

export default {
  initialize,
};
