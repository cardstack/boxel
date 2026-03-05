import { assert } from '@ember/debug';
import loadConfigFromMeta from '@embroider/config-meta-loader';

const config = loadConfigFromMeta('@cardstack/host') as unknown;

assert(
  'config is not an object',
  typeof config === 'object' && config !== null,
);
assert(
  'modulePrefix was not detected on your config',
  'modulePrefix' in config && typeof config.modulePrefix === 'string',
);
assert(
  'locationType was not detected on your config',
  'locationType' in config && typeof config.locationType === 'string',
);
assert(
  'rootURL was not detected on your config',
  'rootURL' in config && typeof config.rootURL === 'string',
);
assert(
  'APP was not detected on your config',
  'APP' in config && typeof config.APP === 'object',
);

export default config as {
  environment: string;
  modulePrefix: string;
  podModulePrefix: string;
  locationType: 'history' | 'hash' | 'none' | 'auto';
  rootURL: string;
  APP: Record<string, unknown>;
  matrixURL: string;
  matrixServerName: string;

  realmServerURL: string;
  resolvedBaseRealmURL: string;
  resolvedCatalogRealmURL: string;
  resolvedSkillsRealmURL: string;
  hostsOwnAssets: boolean;
  realmsServed?: string[];
  logLevels: string;
  iconsURL: string;
  autoSaveDelayMs: number;
  monacoDebounceMs: number;
  monacoCursorDebounceMs: number;
  serverEchoDebounceMs: number;
  loginMessageTimeoutMs: number;
  minSaveTaskDurationMs: number;
  cardRenderTimeout: number;
  sqlSchema: string;
  assetsURL: string;
  stripePaymentLink: string;
  featureFlags?: {
    SHOW_ASK_AI?: boolean;
    AI_PATCHING_CORRECTNESS_CHECKS?: boolean;
  };
  publishedRealmDomainOverrides: string;
  publishedRealmBoxelSpaceDomain: string;
  publishedRealmBoxelSiteDomain: string;
  cardSizeLimitBytes: number;
  fileSizeLimitBytes: number;
  defaultSystemCardId: string;
} & Record<string, unknown>;
