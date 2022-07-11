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
import { timeout } from '@cardstack/worker/src/util';
import { Deferred } from '@cardstack/runtime-common';
import { TaskInstance } from 'ember-resources';

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
        break;
      case 'wait-for-worker-handle-receipt':
        if (data.type === 'setDirectoryHandleAcknowledged') {
          this.state.wait.fulfill(new URL(data.url));
          return;
        }
        break;
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
    let { handle, url } = await this.state.response.promise;
    if (handle && url) {
      this.state = {
        type: 'available',
        handle,
        worker: this.state.worker,
        url: new URL(url),
      };
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
        url: URL;
        worker: ServiceWorker;
      }
    | {
        type: 'wait-for-worker-handle-receipt';
        worker: ServiceWorker;
        handle: FileSystemDirectoryHandle;
        wait: Deferred<URL>;
      } = { type: 'starting-up' };

  get isAvailable(): boolean {
    this.maybeSetup();
    return this.state.type === 'available';
  }

  get url(): URL {
    this.maybeSetup();
    if (this.state.type !== 'available') {
      throw new Error(`Cannot get url in state ${this.state.type}`);
    }
    return this.state.url;
  }

  get isEmpty(): boolean {
    this.maybeSetup();
    return this.state.type === 'empty';
  }

  get isLoading(): boolean {
    this.maybeSetup();
    return this.state.type === 'starting-up';
  }

  get startedUp(): TaskInstance<void> | null {
    this.maybeSetup();
    return taskFor(this.setup).last;
  }

  chooseDirectory(cb?: () => void): void {
    taskFor(this.openDirectory).perform(cb);
  }

  close(): void {
    if (this.state.type !== 'available') {
      throw new Error(`Cannot close local realm in state ${this.state.type}`);
    }
    send(this.state.worker, {
      type: 'setDirectoryHandle',
      handle: null,
    });
    this.state = { type: 'empty', worker: this.state.worker };
  }

  @restartableTask private async openDirectory(cb?: () => void) {
    let handle = await showDirectoryPicker();

    // write a sacrificial file in order to prompt the browser to ask the user
    // for permission to write files
    let file = await handle.getFileHandle('.tmp', { create: true });
    let stream = await (file as any).createWritable();
    await stream.write('');
    await stream.close();

    await handle.removeEntry('.tmp');

    if (this.state.type !== 'empty') {
      throw new Error(
        `tried to chooseDirectory when we already have a local realm`
      );
    }
    this.state = {
      type: 'wait-for-worker-handle-receipt',
      handle,
      worker: this.state.worker,
      wait: new Deferred<URL>(),
    };

    send(this.state.worker, {
      type: 'setDirectoryHandle',
      handle,
    });
    let url = await this.state.wait.promise;

    this.state = { type: 'available', handle, worker: this.state.worker, url };

    if (cb) {
      cb();
    }
  }

  private async ensureWorker() {
    let registration = await navigator.serviceWorker.register('./worker.js', {
      scope: '/',
    });
    registration.addEventListener('updatefound', () => {
      // if we see a new service worker version getting installed, and if we
      // already have an open file handle, send it to the new worker so we don't
      // lose access
      if (this.state.type === 'available') {
        send(registration.installing!, {
          type: 'setDirectoryHandle',
          handle: this.state.handle,
        });
      }
    });
    while (registration.active?.state !== 'activated') {
      await timeout(10);
    }

    return navigator.serviceWorker.controller!;
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-realm': LocalRealm;
  }
}
