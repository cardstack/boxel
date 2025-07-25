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
  resolvedSkillsRealmURL: string;
  hostModeDomainRoot?: string;
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
  renderTimeoutMs: number;
  sqlSchema: string;
  assetsURL: string;
  stripePaymentLink: string;
  featureFlags?: {
    SHOW_ASK_AI?: boolean;
  };
};
