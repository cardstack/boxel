import Service from '@ember/service';
import { logger } from '@cardstack/runtime-common';

// Perhaps it would be easier to just move this function to globalThis...
export default class LogService extends Service {
  logger(logName: string) {
    return logger(logName);
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your services.
declare module '@ember/service' {
  interface Registry {
    log: LogService;
  }
}
