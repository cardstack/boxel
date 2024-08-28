import Service from '@ember/service';

import type * as MatrixSDK from 'matrix-js-sdk';

/*
  This abstracts over the matrix SDK, including several extra functions that are
  actually implemented via direct HTTP.
*/
export default class MatrixSDKLoader extends Service {
  #extended: ExtendedMatrixSDK | undefined;

  async load(): Promise<ExtendedMatrixSDK> {
    if (!this.#extended) {
      let sdk = await import('matrix-js-sdk');
      this.#extended = new ExtendedMatrixSDK(sdk);
    }
    return this.#extended;
  }
}

export class ExtendedMatrixSDK {
  #sdk: typeof MatrixSDK;

  constructor(sdk: typeof MatrixSDK) {
    this.#sdk = sdk;
  }

  get RoomMemberEvent() {
    return this.#sdk.RoomMemberEvent;
  }

  get RoomEvent() {
    return this.#sdk.RoomEvent;
  }

  get Preset() {
    return this.#sdk.Preset;
  }

  createClient(opts: MatrixSDK.ICreateClientOpts) {
    return this.#sdk.createClient(opts);
  }
}
