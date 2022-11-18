// this file should be portable to both DOM and ServiceWorker contexts. It
// establishes the common API between them.

export interface RequestDirectoryHandle {
  type: 'requestDirectoryHandle';
}
export interface SetDirectoryHandleAcknowledged {
  type: 'setDirectoryHandleAcknowledged';
  url: string;
}

export interface DirectoryHandleResponse {
  type: 'directoryHandleResponse';
  handle: FileSystemDirectoryHandle | null;
  url: string | null;
}

export interface SetDirectoryHandle {
  type: 'setDirectoryHandle';
  handle: FileSystemDirectoryHandle | null;
}

export type ClientMessage = RequestDirectoryHandle | SetDirectoryHandle;
export type WorkerMessage =
  | DirectoryHandleResponse
  | SetDirectoryHandleAcknowledged;
export type Message = ClientMessage | WorkerMessage;

function isMessageLike(
  maybeMessage: unknown
): maybeMessage is { type: string } {
  return (
    typeof maybeMessage === 'object' &&
    maybeMessage !== null &&
    'type' in maybeMessage &&
    typeof (maybeMessage as any).type === 'string'
  );
}

export function isClientMessage(message: unknown): message is ClientMessage {
  if (!isMessageLike(message)) {
    return false;
  }
  switch (message.type) {
    case 'requestDirectoryHandle':
      return true;
    case 'setDirectoryHandle':
      return (
        'handle' in message &&
        ((message as any).handle === null ||
          (message as any).handle instanceof FileSystemDirectoryHandle)
      );
    default:
      return false;
  }
}

export function isWorkerMessage(message: unknown): message is WorkerMessage {
  if (!isMessageLike(message)) {
    return false;
  }
  switch (message.type) {
    case 'directoryHandleResponse':
      return (
        'handle' in message &&
        ((message as any).handle === null ||
          (message as any).handle instanceof FileSystemDirectoryHandle)
          && 'url' in message && ((message as any).url === null || typeof (message as any).url === 'string' ) 
      );
    case 'setDirectoryHandleAcknowledged':
      return 'url' in message && typeof (message as any).url === 'string';
    default:
      return false;
  }
}

interface Destination {
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
}

export function send(destination: Destination, message: Message): void {
  destination.postMessage(message);
}
