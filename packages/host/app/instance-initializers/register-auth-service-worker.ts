import type ApplicationInstance from '@ember/application/instance';

import { registerAuthServiceWorker } from '../utils/auth-service-worker-registration';

// Register the auth service worker eagerly at app boot, before any lazy
// services are instantiated. This ensures realm tokens are synced to the
// SW before card rendering triggers image requests to authenticated realms.
export function initialize(_appInstance: ApplicationInstance): void {
  registerAuthServiceWorker();
}

export default {
  initialize,
};
