import Service from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';

import {
  isWorkerMessage,
  DirectoryHandleResponse,
  send,
} from '@cardstack/worker/src/messages';
import { timeout, Deferred } from '@cardstack/worker/src/util';

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
    let { data } = event;
    if (!isWorkerMessage(data)) {
      return;
    }
    switch (this.state.type) {
      case 'requesting-handle':
        if (data.type === 'directoryHandleResponse') {
          this.state.response.fulfill(data);
          return;
        }
    }
    console.log(`did not handle worker message`, data);
  }

  @restartableTask private async setup(): Promise<void> {
    await Promise.resolve();
    this.state = { type: 'checking-worker' };
    let worker = await this.ensureWorker();
    this.state = {
      type: 'requesting-handle',
      worker,
      response: new Deferred<DirectoryHandleResponse>(),
    };
    send(this.state.worker, { type: 'requestDirectoryHandle' });
    let { handle } = await this.state.response.promise;
    if (handle) {
      this.state = { type: 'available', handle, worker: this.state.worker };
    } else {
      this.state = { type: 'empty', worker: this.state.worker };
    }
  }

  private maybeSetup() {
    if (this.state.type === 'starting-up') {
      taskFor(this.setup).perform();
    }
  }

  @tracked
  private state:
    | { type: 'starting-up' }
    | { type: 'checking-worker' }
    | {
        type: 'requesting-handle';
        worker: ServiceWorker;
        response: Deferred<DirectoryHandleResponse>;
      }
    | { type: 'empty'; worker: ServiceWorker }
    | {
        type: 'available';
        handle: FileSystemDirectoryHandle;
        worker: ServiceWorker;
      } = { type: 'starting-up' };

  get isAvailable(): boolean {
    this.maybeSetup();
    return this.state.type === 'available';
  }

  get fsHandle(): FileSystemDirectoryHandle {
    if (this.state.type !== 'available') {
      throw new Error(`fsHandle is not available in state ${this.state.type}`);
    }
    return this.state.handle;
  }

  get isEmpty(): boolean {
    this.maybeSetup();
    return this.state.type === 'empty';
  }

  get isLoading(): boolean {
    this.maybeSetup();
    return this.state.type === 'starting-up';
  }

  chooseDirectory(): void {
    taskFor(this.openDirectory).perform();
  }

  @restartableTask private async openDirectory() {
    let handle = await showDirectoryPicker();
    if (this.state.type !== 'empty') {
      throw new Error(
        `tried to chooseDirectory when we already have a local realm`
      );
    }
    send(this.state.worker, {
      type: 'setDirectoryHandle',
      handle,
    });
    this.state = { type: 'available', handle, worker: this.state.worker };
  }

  private async ensureWorker() {
    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.register('./worker.js', {
        scope: '/',
      });
      let registration = await navigator.serviceWorker.ready;
      while (registration.active?.state !== 'activated') {
        await timeout(10);
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
