// Sadly. the sqlite3 worker API is untyped. when you opt into that API you are opting
// out of the synchronous API that this module previously declared declarations
// for, so these types stomp over the synchronous interface's types.

type SQLiteWorkerOperationType =
  | 'open'
  | 'close'
  | 'config-get'
  | 'exec'
  | 'export';

interface OpenConfig {
  filename: string;
  flags?: string;
}

interface CloseConfig {
  dbId: string;
  args?: { unlink?: boolean };
}

interface ExecConfig {
  dbId: string;
  sql: string;
  bind?: any[];
  callback?: (row: {
    type: string;
    row: any[] | undefined;
    rowNumber: number | null;
    columnNames: string[];
  }) => void;
}
interface ExportConfig {
  dbId: string;
}

type Configuration<T extends SQLiteWorkerOperationType> = T extends 'open'
  ? OpenConfig
  : T extends 'config-get'
  ? {}
  : T extends 'close'
  ? CloseConfig
  : T extends 'exec'
  ? ExecConfig
  : T extends 'export'
  ? ExportConfig
  : never;

interface OpenResponse {
  type: 'open';
  messageId: string;
  dbId: string;
  result: {
    dbId: string;
    filename: string;
    persistent: boolean;
    vfs: string;
  };
}

type CloseResponse = OpenResponse;

interface GetConfigResponse {
  type: 'config-get';
  messageId: string;
  result: {
    bigIntEnabled: boolean;
    opfsEnabled: boolean;
    version: {
      downloadVersion: number;
      libVersion: string;
      libVersionNumber: number;
      sourceId: string;
    };
    vfsList: string[];
  };
}

interface ExecResponse {
  type: 'exec';
  dbId: string;
  messageId: string;
  result: {
    sql: string;
    input?: any[];
  };
}

interface ExportResponse {
  type: 'export';
  dbId: string;
  messageId: string;
  result: {
    byteArray: Uint8Array;
    filename: string;
    mimetype: 'application/x-sqlite3';
  };
}

type Response<T extends SQLiteWorkerOperationType> = T extends 'open'
  ? OpenResponse
  : T extends 'config-get'
  ? GetConfigResponse
  : T extends 'close'
  ? CloseResponse
  : T extends 'exec'
  ? ExecResponse
  : T extends 'export'
  ? ExportResponse
  : never;

export declare function SQLiteWorker<T extends SQLiteWorkerOperationType>(
  action: T,
  config: Configuration<T>,
): Promise<Response<T>>;

declare module '@sqlite.org/sqlite-wasm' {
  export function sqlite3Worker1Promiser(config: {
    onready: () => void;
    debug?: (...data: any[]) => void;
  }): Promiser;
}
