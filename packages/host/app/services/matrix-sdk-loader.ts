import Service from '@ember/service';

import type * as MatrixSDK from 'matrix-js-sdk';

export default class MatrixSDKLoader extends Service {
  async load(): Promise<typeof MatrixSDK> {
    return import('matrix-js-sdk');
  }
}
