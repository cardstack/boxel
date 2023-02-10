import Service from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import log from 'loglevel';

log.setDefaultLevel(ENV.logLevel);

export default class LogService extends Service {
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
