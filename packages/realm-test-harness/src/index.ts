export {
  ensureCombinedFactoryRealmTemplate,
  ensureFactoryRealmTemplate,
  fetchRealmCardJson,
  getFactoryTestContext,
  startFactoryGlobalContext,
  startFactoryRealmServer,
  startFactorySupportServices,
  type CombinedRealmTemplateResult,
} from './api.ts';

export type {
  FactoryRealmOptions,
  FactoryRealmTemplate,
  FactoryTestContext,
  RealmConfig,
  StartedFactoryRealm,
} from './shared.ts';

export {
  buildRealmToken,
  buildServerToken,
  diagnosePortConflict,
  findAndHoldAvailablePort,
  holdSpecificPort,
  isFactorySupportContext,
  type PortReservation,
} from './shared.ts';

export { startHarnessPrerenderServer } from './support-services.ts';

export { startCompatRealmProxy } from './isolated-realm-stack.ts';

export type { StartedCompatRealmProxy } from './shared.ts';

export * from './runtime-metadata.ts';

export {
  fileExists,
  findRootRepoCheckoutDir,
  findHostDistPackageDir,
} from './host-dist.ts';

export { configureLogger, logger } from './logger.ts';
export type { Logger, LogLevel } from './logger.ts';
