import Service from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import log from 'loglevel';

export default class LogService extends Service {
  constructor() {
    super();
    log.setDefaultLevel(ENV.logLevel);
  }

  get log() {
    return log;
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your services.
declare module '@ember/service' {
  interface Registry {
    log: LogService;
  }
}
