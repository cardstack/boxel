import type ApplicationInstance from '@ember/application/instance';

// `command-service` is a legacy lookup key for `tool-service`: realm
// content can look services up by string (e.g.
// `getService('command-service')` in catalog test cards), so the old key
// resolves to the SAME tool-service singleton — not a second instance,
// which would fork the service's execution-tracking state. Removable only
// when no deployed content references the old key.
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
