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
  otherRealmURLs: string[];
  matrixURL: string;
  matrixServerName: string;
  experimentalAIEnabled: boolean;
  resolvedBaseRealmURL: string;
  hostsOwnAssets: boolean;
  realmsServed?: string[];
  logLevels: string;
  resolvedOwnRealmURL: string;
  autoSaveDelayMs: number;
  monacoDebounceMs: number;
  monacoCursorDebounceMs: number;
  serverEchoDebounceMs: number;
  loginMessageTimeoutMs: number;
  minSaveTaskDurationMs: number;
  sqlSchema: string;
  featureFlags?: {
    'pg-indexer'?: boolean;
  };
};
