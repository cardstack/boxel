export default config;
import { LogLevelNames } from 'loglevel';

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
  demoRealmURL: string;
  resolvedBaseRealmURL: string;
  logLevel: LogLevelNames;
  currentRunLogLevel: LogLevelNames;
};
