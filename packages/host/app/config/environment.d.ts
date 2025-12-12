export default config;

/**
 * Type declarations for
 *    import config from 'my-app/config/environment'
 */
declare const config: {
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
  aiAssistantToastTimeoutMs: number;
  cardRenderTimeout: number;
  sqlSchema: string;
  assetsURL: string;
  stripePaymentLink: string;
  featureFlags?: {
    SHOW_ASK_AI?: boolean;
    AI_PATCHING_CORRECTNESS_CHECKS?: boolean;
  };
  publishedRealmBoxelSpaceDomain: string;
  publishedRealmBoxelSiteDomain: string;
  defaultSystemCardId: string;
};
