import { isClientMessage, send } from './messages';
import assertNever from 'assert-never';
import { Deferred } from '@cardstack/runtime-common/deferred';
import {
  type EntrySetter,
  type RunnerRegistration,
  type RunState,
} from '@cardstack/runtime-common/search-index';

export class MessageHandler {
  fs: FileSystemDirectoryHandle | null = null;
  startingUp: Promise<void>;
  private finishedStarting!: () => void;
  private entrySetter: EntrySetter | undefined;
  private source: Client | ServiceWorker | MessagePort | undefined | null;
  private fromScratchDeferred: Deferred<RunState> | undefined;
  private incrementalDeferred: Deferred<RunState> | undefined;

  constructor(worker: ServiceWorkerGlobalScope) {
    this.startingUp = new Promise((res) => (this.finishedStarting = res));
    worker.addEventListener('message', (event) => {
      this.handle(event);
    });
  }

  async setupIndexRunner(
    registerRunner: RunnerRegistration,
    entrySetter: EntrySetter
  ) {
    this.entrySetter = entrySetter;
    await registerRunner(
      this.fromScratch.bind(this),
      this.incremental.bind(this)
    );
  }

  handle(event: ExtendableMessageEvent) {
    let { data, source } = event;
    if (!isClientMessage(data) || !source) {
      return;
    }
    this.source = source;
    switch (data.type) {
      case 'requestDirectoryHandle':
        {
          send(source, {
            type: 'directoryHandleResponse',
            handle: this.fs,
            url: 'http://local-realm/', // TODO: this is hardcoded, should come from realm.url
          });
        }
        return;
      case 'setDirectoryHandle':
        {
          this.fs = data.handle;
          this.finishedStarting();
          if (this.fs) {
            send(source, {
              type: 'setDirectoryHandleAcknowledged',
              url: 'http://local-realm/', // TODO: this is hardcoded, should come from realm.url
            });
          }
        }
        return;
      case 'setEntry':
        {
          if (!this.entrySetter) {
            throw new Error(
              `no entrySetter provided in MessageHandler.setup()`
            );
          }
          let { url, entry } = data;
          this.entrySetter(new URL(url), entry);
          send(source, { type: 'setEntryAcknowledged' });
        }
        return;
      case 'fromScratchCompleted':
        {
          if (!this.fromScratchDeferred) {
            throw new Error(
              `received from scratch index completion response without corresponding request`
            );
          }
          let { state } = data;
          this.fromScratchDeferred.fulfill(state);
        }
        return;
      case 'incrementalCompleted':
        {
          if (!this.incrementalDeferred) {
            throw new Error(
              `received incremental index completion response without corresponding request`
            );
          }
          let { state } = data;
          this.incrementalDeferred.fulfill(state);
        }
        return;
      default:
        throw assertNever(data);
    }
  }

  private async fromScratch(realmURL: URL): Promise<RunState> {
    if (!this.source) {
      throw new Error(
        `Can't perform fromScratch indexing, the service worker doesn't know which DOM to talk to`
      );
    }
    this.fromScratchDeferred = new Deferred();
    send(this.source, {
      type: 'startFromScratch',
      realmURL: realmURL.href,
    });
    return this.fromScratchDeferred.promise;
  }

  private async incremental(
    prev: RunState,
    url: URL,
    operation: 'update' | 'delete'
  ): Promise<RunState> {
    if (!this.source) {
      throw new Error(
        `Can't perform incremental indexing, the service worker doesn't know which DOM to talk to`
      );
    }
    this.incrementalDeferred = new Deferred();
    send(this.source, {
      type: 'startIncremental',
      prev,
      url: url.href,
      operation,
    });
    return this.incrementalDeferred.promise;
  }
}
