import type ApplicationInstance from '@ember/application/instance';

// `tool-service` was registered as `command-service` before the
// command → tool rename, and realm content can look services up by that
// string (e.g. `getService('command-service')` in catalog test cards).
// This registers the old name as an alias that resolves to the SAME
// tool-service singleton — not a second instance, which would fork the
// service's execution-tracking state. Removable only when no deployed
// content references the old name.
export function initialize(appInstance: ApplicationInstance): void {
  appInstance.register('service:command-service', {
    create() {
      return appInstance.lookup('service:tool-service');
    },
  } as any);
}

export default {
  initialize,
};
