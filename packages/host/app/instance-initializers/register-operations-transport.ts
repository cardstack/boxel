import type ApplicationInstance from '@ember/application/instance';

import type OperationsService from '../services/operations';

// Arm the operations transport at boot.
//
// A card reaches its operations through a global bridge rather than through
// service injection — it loads inside a card module, where there is no owner
// to inject from — and the host's service is what registers on that bridge.
// Ember services are lazy, so without this the bridge would be armed only once
// something else happened to inject the service, and the first card to invoke
// an operation would be told there is no transport in this environment.
export function initialize(appInstance: ApplicationInstance): void {
  appInstance.lookup('service:operations') as OperationsService | undefined;
}

export default {
  initialize,
};
