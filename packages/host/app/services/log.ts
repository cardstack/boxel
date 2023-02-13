import Service from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import log from 'loglevel';

log.setDefaultLevel(ENV.logLevel);

let currentRunLog = log.getLogger('host:current-run');
currentRunLog.setDefaultLevel(ENV.currentRunLogLevel);

export default class LogService extends Service {
  get log() {
    return log;
  }

  get currentRunLog() {
    return currentRunLog;
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your services.
declare module '@ember/service' {
  interface Registry {
    log: LogService;
  }
}
