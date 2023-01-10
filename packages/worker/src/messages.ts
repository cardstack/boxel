// this file should be portable to both DOM and ServiceWorker contexts. It
// establishes the common API between them.
import {
  type SearchEntryWithErrors,
  type RunState,
} from '@cardstack/runtime-common/search-index';

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

export interface SetEntry {
  type: 'setEntry';
  url: string;
  entry: SearchEntryWithErrors;
}

export interface SetEntryAcknowledged {
  type: 'setEntryAcknowledged';
}

export interface StartFromScratchIndex {
  type: 'startFromScratch';
  realmURL: string;
}

export interface FromScratchCompleted {
  type: 'fromScratchCompleted';
  state: RunState;
}

export interface StartIncrementalIndex {
  type: 'startIncremental';
  prev: RunState;
  url: string;
  operation: 'delete' | 'update';
}

export interface IncrementalCompleted {
  type: 'incrementalCompleted';
  state: RunState;
}

export type ClientMessage =
  | RequestDirectoryHandle
  | SetDirectoryHandle
  | SetEntry
  | FromScratchCompleted
  | IncrementalCompleted;
export type WorkerMessage =
  | DirectoryHandleResponse
  | SetDirectoryHandleAcknowledged
  | SetEntryAcknowledged
  | StartFromScratchIndex
  | StartIncrementalIndex;
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
    case 'getRunStateRequest':
    case 'requestDirectoryHandle':
      return true;
    case 'setDirectoryHandle':
      return (
        'handle' in message &&
        ((message as any).handle === null ||
          (message as any).handle instanceof FileSystemDirectoryHandle)
      );
    case 'setEntry':
      return (
        'url' in message &&
        typeof message.url === 'string' &&
        'entry' in message &&
        typeof message.entry === 'object' &&
        message.entry != null
      );
    case 'incrementalCompleted':
    case 'fromScratchCompleted':
      return (
        'state' in message &&
        typeof message.state === 'object' &&
        message.state != null
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
    case 'setEntryAcknowledged':
    case 'setRunStateAcknowledged':
      return true;
    case 'directoryHandleResponse':
      return (
        'handle' in message &&
        ((message as any).handle === null ||
          (message as any).handle instanceof FileSystemDirectoryHandle) &&
        'url' in message &&
        ((message as any).url === null ||
          typeof (message as any).url === 'string')
      );
    case 'setDirectoryHandleAcknowledged':
      return 'url' in message && typeof (message as any).url === 'string';
    case 'startFromScratch':
      return 'realmURL' in message && typeof message.realmURL === 'string';
    case 'startIncremental':
      return (
        'prev' in message &&
        typeof message.prev === 'object' &&
        message.prev != null &&
        'url' in message &&
        typeof message.url === 'string' &&
        'operation' in message &&
        typeof message.operation === 'string' &&
        ['update', 'delete'].includes(message.operation)
      );
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
