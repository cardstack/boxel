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
  ownRealmURL: string;
  otherRealmURL?: string;
  matrixURL: string;
  resolvedBaseRealmURL: string;
  hostsOwnAssets: boolean;
  realmsServed?: string[];
  logLevels: string;
  resolvedOwnRealmURL: string;
  autoSaveDelayMs: number;
};
