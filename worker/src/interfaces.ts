export interface RequestDirectoryHandle {
  type: 'requestDirectoryHandle';
}

export interface DirectoryHandleResponse {
  type: 'directoryHandleResponse';
  handle: FileSystemDirectoryHandle | null;
}

export function isMessage(message: unknown): message is Message {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as any).type === 'requestDirectoryHandle'
  );
}

export type Message = RequestDirectoryHandle | DirectoryHandleResponse;

interface Destination {
  postMessage(message: any, transfer: Transferable[]): void;
  postMessage(message: any, options?: StructuredSerializeOptions): void;
}

export function send(destination: Destination, message: Message): void {
  destination.postMessage(message);
}
