import { isClientMessage, send } from './messages';
import assertNever from 'assert-never';
import { Deferred } from '@cardstack/runtime-common/deferred';

let visitIds = 0;

export class MessageHandler {
  fs: FileSystemDirectoryHandle | null = null;
  private finishedStarting!: () => void;
  startingUp: Promise<void>;
  private source: Client | ServiceWorker | MessagePort | undefined | null;
  private pendingVisits = new Map<
    string,
    { path: string; deferred: Deferred<string> }
  >();

  constructor(worker: ServiceWorkerGlobalScope) {
    this.startingUp = new Promise((res) => (this.finishedStarting = res));
    worker.addEventListener('message', (event) => {
      this.handle(event);
    });
  }

  handle(event: ExtendableMessageEvent) {
    let { data, source } = event;
    this.source = source;
    if (!isClientMessage(data) || !source) {
      return;
    }
    switch (data.type) {
      case 'requestDirectoryHandle':
        send(source, {
          type: 'directoryHandleResponse',
          handle: this.fs,
          url: 'http://local-realm/', // TODO: this is hardcoded, should come from realm.url
        });
        return;
      case 'setDirectoryHandle':
        this.fs = data.handle;
        this.finishedStarting();
        if (this.fs) {
          send(source, {
            type: 'setDirectoryHandleAcknowledged',
            url: 'http://local-realm/', // TODO: this is hardcoded, should come from realm.url
          });
        }
        return;
      case 'visitResponse':
        let { id, html, path } = data;
        let visit = this.pendingVisits.get(id);
        if (!visit) {
          throw new Error(
            `received a visitResponse from the client that has no correlating worker request, id: ${id}, path ${path}`
          );
        }
        let { deferred } = visit;
        deferred.fulfill(html);
        this.pendingVisits.delete(id);
        return;
      default:
        throw assertNever(data);
    }
  }

  async visit(path: string, staticResponses: Map<string, string>) {
    if (!this.source) {
      throw new Error(
        `Can't visit ${path}, the service worker doesn't know which DOM to talk to`
      );
    }
    let deferred = new Deferred<string>();
    let id = String(visitIds++);
    this.pendingVisits.set(id, { path, deferred });
    send(this.source, {
      type: 'visitRequest',
      path,
      id,
      staticResponses,
    });

    // TODO implement a timeout
    return await deferred.promise;
  }
}
