import Service, { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { registerDestructor } from '@ember/destroyable';
import { LocalRealmAdapter } from '@cardstack/worker/src/local-realm-adapter';
import {
  isWorkerMessage,
  DirectoryHandleResponse,
  send,
} from '@cardstack/worker/src/messages';
import { timeout } from '@cardstack/worker/src/util';
import { Deferred, logger } from '@cardstack/runtime-common';
import { TaskInstance } from 'ember-resources';
import RenderService from './render-service';
import type RouterService from '@ember/routing/router-service';
import {
  serializeRunState,
  deserializeRunState,
  type SearchEntryWithErrors,
  type RunState,
} from '@cardstack/runtime-common/search-index';
import ENV from '@cardstack/host/config/environment';

const { isLocalRealm, ownRealmURL, realmsServed = [] } = ENV;
const log = logger('service:local-realm');

export default class LocalRealm extends Service {
  #setEntryDeferred: Deferred<void> | undefined;
  #fromScratch: ((realmURL: URL) => Promise<RunState>) | undefined;
  #incremental:
    | ((
        prev: RunState,
        url: URL,
        operation: 'update' | 'delete'
      ) => Promise<RunState>)
    | undefined;

  constructor(properties: object) {
    super(properties);
    if (!this.fastboot.isFastBoot && isLocalRealm) {
      let handler = (event: MessageEvent) => this.handleMessage(event);
      navigator.serviceWorker.addEventListener('message', handler);
      registerDestructor(this, () =>
        navigator.serviceWorker.removeEventListener('message', handler)
      );
    }
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
          this.state.wait.fulfill();
          return;
        }
        break;
      case 'available':
        if (data.type === 'setEntryAcknowledged') {
          if (!this.#setEntryDeferred) {
            throw new Error(
              `received setEntry acknowledgement without corresponding setEntry request`
            );
          }
          this.#setEntryDeferred.fulfill();
          return;
        }
        if (data.type === 'startFromScratch') {
          if (!this.#fromScratch) {
            throw new Error(
              `the fromScratch runner has not been registered with the local realm service`
            );
          }
          let { realmURL } = data;
          let worker = this.state.worker;
          this.#fromScratch(new URL(realmURL)).then((state) => {
            send(worker, {
              type: 'fromScratchCompleted',
              state: serializeRunState(state),
            });
          });
          return;
        }
        if (data.type === 'startIncremental') {
          if (!this.#incremental) {
            throw new Error(
              `the incremental runner has not been registered with the local realm service`
            );
          }
          let { prev, url, operation } = data;
          let worker = this.state.worker;
          this.#incremental(
            deserializeRunState(prev),
            new URL(url),
            operation
          ).then((state) =>
            send(worker, {
              type: 'incrementalCompleted',
              state: serializeRunState(state),
            })
          );
          return;
        }
    }
    log.error(`did not handle worker message`, data);
  }

  setupIndexing(
    fromScratch: (realmURL: URL) => Promise<RunState>,
    incremental: (
      prev: RunState,
      url: URL,
      operation: 'update' | 'delete'
    ) => Promise<RunState>
  ) {
    this.#fromScratch = fromScratch;
    this.#incremental = incremental;
  }

  private setup = restartableTask(async () => {
    if (this.fastboot.isFastBoot) {
      this.state = { type: 'fastboot', worker: undefined };
      return;
    }
    if (!isLocalRealm) {
      this.state = {
        type: 'remote-realm',
        worker: undefined,
      };
      return;
    }
    await Promise.resolve();
    this.state = { type: 'checking-worker' };
    let worker = await this.ensureWorker();
    this.state = {
      type: 'requesting-handle',
      worker,
      response: new Deferred<DirectoryHandleResponse>(),
    };
    send(this.state.worker, { type: 'requestDirectoryHandle', realmsServed });
    let { handle } = await this.state.response.promise;
    if (handle) {
      this.state = {
        type: 'available',
        handle,
        worker: this.state.worker,
        adapter: new LocalRealmAdapter(handle),
      };
    } else {
      this.state = { type: 'empty', worker: this.state.worker };
    }
  });

  private maybeSetup() {
    if (this.state.type === 'starting-up') {
      this.setup.perform();
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
    | { type: 'fastboot'; worker: undefined }
    | { type: 'remote-realm'; worker: undefined }
    | {
        type: 'available';
        handle: FileSystemDirectoryHandle;
        worker: ServiceWorker;
        adapter: LocalRealmAdapter;
      }
    | {
        type: 'wait-for-worker-handle-receipt';
        worker: ServiceWorker;
        handle: FileSystemDirectoryHandle;
        wait: Deferred<void>;
      } = { type: 'starting-up' };

  @service declare router: RouterService;
  @service declare fastboot: { isFastBoot: boolean };
  @service declare renderService: RenderService;

  async setEntry(url: URL, entry: SearchEntryWithErrors) {
    if (this.state.type !== 'available') {
      throw new Error(`Cannot setEntry in state ${this.state.type}`);
    }
    this.#setEntryDeferred = new Deferred();
    send(this.state.worker, {
      type: 'setEntry',
      url: url.href,
      entry,
    });
    await this.#setEntryDeferred.promise;
  }

  get isAvailable(): boolean {
    this.maybeSetup();
    return this.state.type === 'available';
  }

  get url(): URL {
    this.maybeSetup();
    return new URL(ownRealmURL);
  }

  get adapter(): LocalRealmAdapter {
    this.maybeSetup();
    if (this.state.type !== 'available') {
      throw new Error(
        `Cannot get LocalRealmAdapter in state ${this.state.type}`
      );
    }
    return this.state.adapter;
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
    return this.setup.last;
  }

  // this is a hook for service worker like fetch proxying for tests
  mapURL(url: string, _reverseLookup = false) {
    return url;
  }

  chooseDirectory(cb?: () => void): void {
    this.openDirectory.perform(cb);
  }

  close(): void {
    if (this.state.type !== 'available') {
      throw new Error(`Cannot close local realm in state ${this.state.type}`);
    }
    send(this.state.worker, {
      type: 'setDirectoryHandle',
      handle: null,
      realmsServed,
    });
    this.state = {
      type: 'empty',
      worker: this.state.worker,
    };
  }

  private openDirectory = restartableTask(async (cb?: () => void) => {
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
      wait: new Deferred<void>(),
    };

    send(this.state.worker, {
      type: 'setDirectoryHandle',
      handle,
      realmsServed,
    });
    await this.state.wait.promise;
    let adapter = new LocalRealmAdapter(handle);

    this.state = {
      type: 'available',
      handle,
      worker: this.state.worker,
      adapter,
    };

    if (cb) {
      cb();
    }
  });

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
          realmsServed,
        });
      }
    });
    while (registration.active?.state !== 'activated') {
      await timeout(10);
    }
    navigator.serviceWorker.oncontrollerchange = () => {
      log.info('worker changed');
      if ('worker' in this.state) {
        this.router.transitionTo('index', {
          queryParams: { path: undefined },
        });
        this.state = { type: 'starting-up' };
        this.maybeSetup();
      }
    };
    return navigator.serviceWorker.controller!;
  }
}

declare module '@ember/service' {
  interface Registry {
    'local-realm': LocalRealm;
  }
}
