export {
  ensureCombinedFactoryRealmTemplate,
  ensureFactoryRealmTemplate,
  fetchRealmCardJson,
  getFactoryTestContext,
  startFactoryGlobalContext,
  startFactoryRealmServer,
  startFactorySupportServices,
  type CombinedRealmTemplateResult,
} from './api';

export type {
  FactoryRealmOptions,
  FactoryRealmTemplate,
  FactoryTestContext,
  RealmConfig,
  StartedFactoryRealm,
} from './shared';

export {
  buildRealmToken,
  buildServerToken,
  diagnosePortConflict,
  findAndHoldAvailablePort,
  isFactorySupportContext,
  type PortReservation,
} from './shared';

export { startHarnessPrerenderServer } from './support-services';

export { startCompatRealmProxy } from './isolated-realm-stack';

export type { StartedCompatRealmProxy } from './shared';

export * from './runtime-metadata';

export {
  fileExists,
  findRootRepoCheckoutDir,
  findHostDistPackageDir,
} from './host-dist';

export { configureLogger, logger } from './logger';
export type { Logger, LogLevel } from './logger';
