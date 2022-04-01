import { isMessage, send } from './interfaces';
import assertNever from 'assert-never';

export class MessageHandler {
  handle(event: ExtendableMessageEvent) {
    let { data, source } = event;
    if (!isMessage(data) || !source) {
      return;
    }
    switch (data.type) {
      case 'requestDirectoryHandle':
        send(source, {
          type: 'directoryHandleResponse',
          handle: null,
        });
        return;
      case 'directoryHandleResponse':
        throw new Error(
          `server received a message that should never come client: ${data.type}`
        );
      default:
        throw assertNever(data);
    }
  }
}
