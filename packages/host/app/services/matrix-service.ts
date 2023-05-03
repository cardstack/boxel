import Service from '@ember/service';
import { createClient } from 'matrix-js-sdk';
import ENV from '@cardstack/host/config/environment';

const { matrixURL } = ENV;

export default class MatrixService extends Service {
  client = createClient({ baseUrl: matrixURL });
}
