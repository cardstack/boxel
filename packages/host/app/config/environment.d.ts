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

  resolvedBaseRealmURL: string;
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
  sqlSchema: string;
  assetsURL: string;
  stripePaymentLink: string;
  featureFlags?: {
    ENABLE_PLAYGROUND: boolean;
    AI_ASSISTANT_EXPERIMENTAL_ATTACHING_FILES_ENABLED: boolean;
  };
};
