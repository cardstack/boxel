import Service from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';

// we're reaching across packages in an odd way here, which works for a
// type-only import but wouldn't necessarily work for runtime code
import type { RequestDirectoryHandle } from '../../../worker/src/interfaces';

export default class LocalRealm extends Service {
  constructor(properties: object) {
    super(properties);
    let handler = (event: MessageEvent) => this.handleMessage(event);
    navigator.serviceWorker.addEventListener('message', handler);
    registerDestructor(this, () =>
      navigator.serviceWorker.removeEventListener('message', handler)
    );
  }

  private handleMessage(event: MessageEvent) {
    console.log(event.data);
  }

  @restartableTask private async update(): Promise<void> {
    await Promise.resolve();
    this.state = { type: 'checking-worker' };
    let worker = await this.ensureWorker();
    this.state = { type: 'requesting-handle', worker };
    let message: RequestDirectoryHandle = {
      type: 'requestDirectoryHandle',
    };
    this.state.worker.postMessage(message);
  }

  private maybeUpdate() {
    if (this.state.type === 'starting-up') {
      taskFor(this.update).perform();
    }
  }

  @tracked
  private state:
    | { type: 'starting-up' }
    | { type: 'checking-worker' }
    | { type: 'requesting-handle'; worker: ServiceWorker }
    | { type: 'empty' }
    | {
        type: 'available';
        handle: FileSystemDirectoryHandle;
      } = { type: 'starting-up' };

  get isAvailable(): boolean {
    this.maybeUpdate();
    return this.state.type === 'available';
  }

  get isEmpty(): boolean {
    this.maybeUpdate();
    return this.state.type === 'empty';
  }

  get isLoading(): boolean {
    this.maybeUpdate();
    return this.state.type === 'starting-up';
  }

  chooseDirectory(): void {}

  private async ensureWorker() {
    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.register('./worker.js', {
        scope: '/',
      });
      let registration = await navigator.serviceWorker.ready;
      while (registration.active?.state !== 'activated') {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
    return navigator.serviceWorker.controller!;
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-realm': LocalRealm;
  }
}
