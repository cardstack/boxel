/**
 * Host-only development server backed by staging Realm + Matrix services.
 * This is the repeatable sandbox/HMR preview used for manual validation.
 */

require('./staging-backend-env').applyStagingBackendEnv();
require('./vite-serve');
