import Service from '@ember/service';

import { logger } from '@cardstack/runtime-common';

export default class LoggerService extends Service {
  getLogger(name: string) {
    return logger(name);
  }
}
