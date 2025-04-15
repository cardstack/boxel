import Service from '@ember/service';

import LogLevel from 'loglevel';

export default class LoggerService extends Service {
  getLogger(name: string) {
    return LogLevel.getLogger(name);
  }

  getLoggers() {
    return LogLevel.getLoggers();
  }
}
