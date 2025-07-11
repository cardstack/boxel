import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

export default class IndexController extends Controller {
  queryParams = [
    'operatorModeState',
    // `sid` and `clientSecret` come from email verification process to reset password
    'sid',
    'clientSecret',
    'cardPath',
    'debug', // temporary debug param for debugging AI assistant code patches
  ];

  @tracked operatorModeState: string | null = null;
  @tracked sid: string | null = null;
  @tracked clientSecret: string | null = null;
  @tracked debug = false;
}
