import { MatrixSearchIndex } from './matrix-search-index';
import { type MatrixClient } from 'matrix-js-sdk';

export class MatrixRealm {
  #searchIndex: MatrixSearchIndex;
  #roomId: string;

  constructor(roomId: string, getClient: () => MatrixClient) {
    this.#roomId = roomId;
    this.#searchIndex = new MatrixSearchIndex(getClient, this.#roomId);
    this.#searchIndex.start();
  }

  get roomId() {
    return this.#roomId;
  }

  shutdown() {
    this.#searchIndex.shutdown();
  }

  // a test utility to await for message events to be indexed
  async flushMessages() {
    await this.#searchIndex.flushMessages();
  }

  // a test utility to await for initial room/membership events to be indexed
  async flushRooms() {
    await this.#searchIndex.flushRooms();
  }

  // url: string;
  // searchIndex: SearchIndex;
  // ready: Promise<void>;
  // start(): Promise<void>;
  // write(path: LocalPath, contents: string): Promise<{ lastModified: number }>;
  // getIndexHTML(opts?: IndexHTMLOptions): Promise<string>;

  // note that append only does not support
  // delete()

  // common handler supports:
  // GET /_info
  // GET /_search
  // GET /_message
  // GET * accept: application/vnd.card+json
  // GET * accept: application/vnd.card+source
  // GET * accept: text/html
  // POST * accept: application/vnd.card+source
  // GET */ accept: application/vnd.json+api (directory listing)

  // note that append only does not support
  //  PATCH * accept: application/vnd.card+json
  //  DELETE * accept: application/vnd.card+json
  //  DELETE * accept: application/vnd.card+source
  // handle(request: MaybeLocalRequest): Promise<ResponseWithNodeStream>;
}
