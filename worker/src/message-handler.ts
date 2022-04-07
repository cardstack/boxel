import { isClientMessage, send } from './messages';
import assertNever from 'assert-never';

export class MessageHandler {
  fs: FileSystemDirectoryHandle | null = null;

  constructor(worker: ServiceWorkerGlobalScope) {
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
        });
        return;
      case 'setDirectoryHandle':
        this.fs = data.handle;
        return;
      default:
        throw assertNever(data);
    }
  }
}
