import { isClientMessage, send } from './messages';
import assertNever from 'assert-never';

export class MessageHandler {
  fs: FileSystemDirectoryHandle | null = null;
  private finishedStarting!: () => void;
  startingUp: Promise<void>;

  constructor(worker: ServiceWorkerGlobalScope) {
    this.startingUp = new Promise((res) => (this.finishedStarting = res));
    worker.addEventListener('message', (event) => {
      this.handle(event);
    });
  }

  handle(event: ExtendableMessageEvent) {
    let { data, source } = event;
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
      default:
        throw assertNever(data);
    }
  }
}
