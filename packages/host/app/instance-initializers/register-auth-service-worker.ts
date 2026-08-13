import type ApplicationInstance from '@ember/application/instance';

import { isBoxelSandboxRuntimeBoot } from '../routes/boxel-sandbox-runtime';
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
  //
  // Also gate on the Sandbox child's own bootstrap route: `appInstance
  // .lookup('service:matrix-service')` below eagerly constructs
  // MatrixService, whose constructor immediately starts its `loadState`
  // task (`document.requestStorageAccess()` then Matrix SDK / sliding-sync
  // connection). None of that is available or needed inside the Sandbox's
  // credentialless, cross-origin iframe — `requestStorageAccess()` is
  // disallowed there and rejects with `NotAllowedError`, and the SDK's
  // subsequent homeserver connection attempt fails outright. The Sandbox
  // child's own authority arrives entirely over its transferred
  // `MessagePort` (RP-15.3), so this eager service-worker/token-sync setup
  // is both unusable and unnecessary there.
  if (!isServiceWorkerSupported() || isBoxelSandboxRuntimeBoot()) {
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
