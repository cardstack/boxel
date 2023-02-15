import { timeout } from './util';
import log from 'loglevel';

export class LivenessWatcher {
  private isAlive = true;
  private listeners: (() => Promise<void>)[] = [];

  constructor(private worker: ServiceWorkerGlobalScope) {
    this.watch();
  }

  get alive() {
    return this.isAlive;
  }

  private async backendIsOurs(): Promise<boolean> {
    let response = await fetch(`${this.worker.origin}/`, {
      method: 'HEAD',
    });
    switch (response.status) {
      case 404:
        return false;
      case 200:
        return /^@cardstack\/host/.test(response.headers.get('server') || '');
      default:
        throw new Error(`${response.status} from backend`);
    }
  }

  private async watch() {
    while (this.isAlive) {
      try {
        this.isAlive = await this.backendIsOurs();
      } catch (err) {
        log.error(
          `Encountered error performing aliveness check (server is probably not running):`,
          err
        );
      }
      if (this.isAlive) {
        await timeout(10 * 1000);
      } else {
        log.error('shutting down service worker.');
        await Promise.all([
          this.worker.registration.unregister(),
          ...this.listeners.map((l) => l()),
        ]);
      }
    }
  }

  registerShutdownListener(fn: () => Promise<void>) {
    this.listeners.push(fn);
  }
}
