import Service from '@ember/service';

import LogLevel from 'loglevel';

import { logger } from '@cardstack/runtime-common';

export default class LoggerService extends Service {
  getLogger(name: string) {
    return logger(name);
  }

  getLoggers() {
    return LogLevel.getLoggers();
  }
}
