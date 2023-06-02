import './e2ee';
import { Deferred } from '@cardstack/runtime-common';
import { MatrixSearchIndex } from './matrix-search-index';
import { type MatrixClient, createClient } from 'matrix-js-sdk';

interface Params {
  matrixServerURL: string;
  accessToken: string;
  userId: string;
  deviceId: string;
  deferStartUp?: true;
}

export class MatrixRealm {
  #startedUp = new Deferred<void>();
  #deferStartup: boolean;
  #client: MatrixClient;
  #matrixServerURL: string;
  #accessToken: string;
  #deviceId: string;
  #userId: string;
  #searchIndex: MatrixSearchIndex;

  constructor({
    matrixServerURL,
    accessToken,
    userId,
    deviceId,
    deferStartUp,
  }: Params) {
    this.#matrixServerURL = matrixServerURL;
    this.#accessToken = accessToken;
    this.#deviceId = deviceId;
    this.#userId = userId;
    this.#client = createClient({ baseUrl: matrixServerURL });
    this.#searchIndex = new MatrixSearchIndex(() => this.#client);

    this.#deferStartup = deferStartUp ?? false;
    if (!deferStartUp) {
      this.#startedUp.fulfill((() => this.#startup())());
    }
  }

  get ready(): Promise<void> {
    return this.#startedUp.promise;
  }

  get #isLoggedIn() {
    return this.#client.isLoggedIn();
  }

  // it's only necessary to call this when the realm is using a deferred startup
  async start() {
    if (this.#deferStartup) {
      this.#startedUp.fulfill((() => this.#startup())());
    }
    await this.ready;
  }

  // primarily a test utility to await for message events to be indexed
  async flushMessages() {
    await this.#searchIndex.flushMessages();
  }

  // primarily a test utility to await for initial room/membership events to be
  // indexed
  async flushRooms() {
    await this.#searchIndex.flushRooms();
  }

  shutdown() {
    // note that it takes about 90 seconds to actually end the process after
    // shutdown() is called due to this bug in the matrix-js-sdk
    // https://github.com/matrix-org/matrix-js-sdk/issues/2472 As a workaround,
    // I identified the problematic timers (there are 2 of them) and we are
    // patching matrix-js-sdk and using `unref()` to tell node that it is ok to
    // exit the process if the problematic timers are still running.
    this.#client.stopClient();
  }

  async #startup() {
    await Promise.resolve();
    // await this.#warmUpCache();
    this.#client = createClient({
      baseUrl: this.#matrixServerURL,
      accessToken: this.#accessToken,
      userId: this.#userId,
      deviceId: this.#deviceId,
    });
    if (!this.#isLoggedIn) {
      throw new Error(
        `couldn't login to matrix server with provided credentials`
      );
    }

    try {
      await this.#client.initCrypto();
    } catch (e) {
      // when there are problems, these exceptions are hard to see so logging them explicitly
      console.error(`Error initializing crypto`, e);
      throw e;
    }

    // this lets us send messages to element clients (useful for testing).
    // probably we wanna verify these unknown devices (when in an encrypted
    // room). need to research how to do that as its undocumented API
    this.#client.setGlobalErrorOnUnknownDevices(false);
    this.#searchIndex.start();
    await this.#client.startClient();

    // TODO need to handle token refresh as our session is very long-lived
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
