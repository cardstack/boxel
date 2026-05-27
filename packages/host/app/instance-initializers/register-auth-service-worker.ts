import type ApplicationInstance from '@ember/application/instance';

import {
  isServiceWorkerSupported,
  registerAuthServiceWorker,
} from '../utils/auth-service-worker-registration';

import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';

// Register the auth service worker eagerly at app boot, before any lazy
// services are instantiated. This ensures realm tokens are synced to the
// SW before card rendering triggers image requests to authenticated realms.
export function initialize(appInstance: ApplicationInstance): void {
  // Gate before lookup so we don't force eager instantiation of matrix /
  // realm services in tests or non-SW environments.
  if (!isServiceWorkerSupported()) {
    return;
  }
  let matrixService = appInstance.lookup('service:matrix-service') as
    | MatrixService
    | undefined;
  let realmService = appInstance.lookup('service:realm') as
    | RealmService
    | undefined;
  if (!matrixService || !realmService) {
    return;
  }
  registerAuthServiceWorker({ matrixService, realmService });
}

export default {
  initialize,
};
